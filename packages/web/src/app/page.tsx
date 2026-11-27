"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { type Wallet } from "@anchor-lang/core";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  activityFor,
  activateSchedule,
  claimSchedule,
  connection,
  createSchedule,
  createStartup,
  fetchStartupByAddressOrMint,
  listPublicStartups,
  listRelevantSchedules,
  listStartups,
  resumeStartup,
  SubmittedTransactionError,
  type ScheduleData,
  type StartupData,
} from "@/lib/chain";
import {
  calcVesting,
  CLUSTER,
  EXPLORER,
  parsePublicKey,
  PROGRAM_ID,
  RPC_URL,
  startupIdBytes,
  toBaseUnits,
  verifyConfiguredCluster,
} from "@/lib/config";
import { saveLocalStartupName, shorten, uint, type TxRow } from "@/lib/format";
import {
  mergeStartupActivity,
  persistStartupTransaction,
  readStartupHistory,
  type StartupTransactionRecord,
} from "@/lib/startup-history";
import {
  transitionTransaction,
  type TransactionPhase,
} from "@/lib/transaction";
import { requireBeneficiaryWallet } from "@/lib/wallet-guard";
import { TopBar } from "@/components/TopBar";
import { NetworkStats } from "@/components/NetworkStats";
import { StatusBanner } from "@/components/StatusBanner";
import { StartupOverview } from "@/components/StartupOverview";
import {
  CreateStartupWizard,
  type CreateStartupSubmitInput,
} from "@/components/CreateStartupWizard";
import {
  VestingManager,
  type VestingSubmitInput,
} from "@/components/VestingManager";

type View = "overview" | "create" | "vesting";

export default function Home() {
  const walletState = useWallet();
  const { publicKey, connected, signTransaction, signAllTransactions } =
    walletState;

  const [view, setView] = useState<View>("overview");
  const [programReady, setProgramReady] = useState<boolean | null>(null);
  const [rpcVerified, setRpcVerified] = useState<boolean | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [startups, setStartups] = useState<StartupData[]>([]);
  const [discoveredStartups, setDiscoveredStartups] = useState<StartupData[]>(
    [],
  );
  const [selected, setSelected] = useState<string>("");
  const [schedules, setSchedules] = useState<ScheduleData[]>([]);
  const [history, setHistory] = useState<TxRow[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [phase, setPhase] = useState<TransactionPhase>("idle");
  const [signatures, setSignatures] = useState<string[]>([]);
  const [now, setNow] = useState(BigInt(Math.floor(Date.now() / 1000)));

  const prevWalletRef = useRef<string | null>(null);

  const signer = useMemo(() => {
    if (!publicKey || !signTransaction || !signAllTransactions) return null;
    return { publicKey, signTransaction, signAllTransactions } as Wallet;
  }, [publicKey, signTransaction, signAllTransactions]);

  const current = useMemo(
    () =>
      startups.find((item) => item.address.toBase58() === selected) ??
      discoveredStartups.find((item) => item.address.toBase58() === selected) ??
      startups[0] ??
      discoveredStartups[0],
    [startups, discoveredStartups, selected],
  );

  // Clear wallet-scoped transient state immediately when wallet disconnects or switches
  useEffect(() => {
    const nextKey = publicKey?.toBase58() ?? null;
    if (prevWalletRef.current !== nextKey) {
      prevWalletRef.current = nextKey;
      setStartups([]);
      setSchedules([]);
      setHistory([]);
      setBalance(null);
      setError("");
      setNotice("");
      setSignatures([]);
      setPhase("idle");
      setSelected("");
    }
  }, [publicKey]);

  const applyPhase = (next: TransactionPhase) =>
    setPhase((previous) => {
      try {
        return transitionTransaction(previous, next);
      } catch {
        return previous;
      }
    });

  const trackSignature = (signature: string) =>
    setSignatures((prev) =>
      prev.includes(signature) ? prev : [...prev, signature],
    );

  const recordTransaction = useCallback(
    (record: StartupTransactionRecord) => {
      if (!publicKey) return;
      persistStartupTransaction(localStorage, publicKey.toBase58(), record);
      if (selected === record.startupAddress || !selected) {
        setHistory((rows) => {
          const next = rows.filter((row) => row.signature !== record.signature);
          return [
            ...next,
            {
              signature: record.signature,
              slot: 0,
              err: record.status === "failed" ? "failed" : null,
              timestamp: Math.floor(record.timestamp / 1000),
              events: [],
              source: "locally recorded" as const,
              operation: record.operation,
              recordedStatus: record.status,
              resultingAccount: record.resultingAccount,
            },
          ].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
        });
      }
    },
    [publicKey, selected],
  );

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [allPublic, info] = await Promise.all([
        listPublicStartups(),
        connection.getAccountInfo(PROGRAM_ID, "confirmed"),
      ]);
      setDiscoveredStartups(allPublic);
      setProgramReady(Boolean(info?.executable));

      let owned: StartupData[] = [];
      if (signer && publicKey) {
        const [lamports, foundOwned] = await Promise.all([
          connection.getBalance(publicKey, "confirmed"),
          listStartups(signer),
        ]);
        setBalance(lamports / LAMPORTS_PER_SOL);
        owned = foundOwned;
        setStartups(foundOwned);
      } else {
        setBalance(null);
        setStartups([]);
      }

      const selectedStartup =
        owned.find((x) => x.address.toBase58() === selected) ??
        allPublic.find((x) => x.address.toBase58() === selected) ??
        owned[0] ??
        allPublic[0];

      if (!selected && selectedStartup) {
        setSelected(selectedStartup.address.toBase58());
      }

      const localHistory =
        selectedStartup && publicKey
          ? readStartupHistory(
              localStorage,
              publicKey.toBase58(),
              selectedStartup.address.toBase58(),
            )
          : [];

      if (localHistory.length > 0) {
        setHistory(
          localHistory.map((row) => ({
            signature: row.signature,
            slot: 0,
            err: row.status === "failed" ? "failed" : null,
            timestamp: Math.floor(row.timestamp / 1000),
            events: [],
            source: "locally recorded",
            operation: row.operation,
            recordedStatus: row.status,
            resultingAccount: row.resultingAccount,
          })),
        );
      }

      const relevantSchedules = await listRelevantSchedules({
        startupAddress: selectedStartup?.address,
        beneficiary: publicKey ?? undefined,
      });
      setSchedules(relevantSchedules);

      if (selectedStartup) {
        const activityTargets = [
          selectedStartup.address,
          ...relevantSchedules
            .filter((row) => row.data.startup.equals(selectedStartup.address))
            .map((row) => row.address),
        ];
        const activities = await Promise.all(
          activityTargets.map((account) => activityFor(account)),
        );
        const merged = mergeStartupActivity<TxRow>(
          localHistory,
          activities.flat(),
        );
        setHistory(
          merged
            .map(({ signature, source, local, rpc }) => ({
              signature,
              slot: rpc?.slot ?? 0,
              err: rpc?.err ?? (local?.status === "failed" ? "failed" : null),
              timestamp:
                rpc?.timestamp ??
                (local ? Math.floor(local.timestamp / 1000) : null),
              events: rpc?.events ?? [],
              source,
              operation: local?.operation,
              recordedStatus: local?.status,
              resultingAccount: local?.resultingAccount,
            }))
            .sort((a, b) => (b.timestamp ?? b.slot) - (a.timestamp ?? a.slot))
            .slice(0, 20),
        );
      } else {
        setHistory([]);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not read confirmed wallet and program state.",
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [signer, publicKey, selected]);

  useEffect(() => {
    let alive = true;
    verifyConfiguredCluster(connection)
      .then(() => alive && setRpcVerified(true))
      .catch((e) => {
        if (alive) {
          setRpcVerified(false);
          setError(
            e instanceof Error ? e.message : "Cluster verification failed.",
          );
        }
      });
    connection
      .getAccountInfo(PROGRAM_ID, "confirmed")
      .then((info) => alive && setProgramReady(Boolean(info?.executable)))
      .catch(() => alive && setProgramReady(false));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(
      () => setNow(BigInt(Math.floor(Date.now() / 1000))),
      5_000,
    );
    return () => clearInterval(timer);
  }, []);

  const run = async (action: () => Promise<string[]>) => {
    setBusy(true);
    setError("");
    setNotice("");
    setSignatures([]);
    applyPhase("preparing");
    try {
      if (!signer) {
        throw new Error("Connect a wallet before starting this operation.");
      }
      if (!rpcVerified) await verifyConfiguredCluster(connection);
      const result = await action();
      setSignatures(result);
      setNotice(
        result.length
          ? "Finalized on Solana. The application re-read the resulting accounts."
          : "The startup was already finalized. The application re-read the onchain mint and vault accounts.",
      );
      await refresh();
    } catch (e) {
      applyPhase("failed");
      if (e instanceof SubmittedTransactionError) {
        trackSignature(e.signature);
      }
      setError(
        e instanceof Error
          ? e.message
          : "Transaction failed. Check the wallet and cluster connection.",
      );
    } finally {
      setBusy(false);
      setStep("");
    }
  };

  const handleCreateStartup = (input: CreateStartupSubmitInput) =>
    run(async () => {
      if (!input.name) throw new Error("Enter a startup display name.");
      setStep("Preparing initialization");
      const result = await createStartup(
        signer!,
        {
          startupName: input.name,
          startupId: input.startupId,
          total: input.totalBase,
          decimals: input.decimals,
          market: input.allocationBase[0]!,
          startup: input.allocationBase[1]!,
          community: input.allocationBase[2]!,
          locked: input.allocationBase[3]!,
        },
        setStep,
        applyPhase,
        trackSignature,
        recordTransaction,
      );
      if (publicKey) {
        saveLocalStartupName(
          result.addresses.startup.toBase58(),
          publicKey.toBase58(),
          input.name,
        );
      }
      setSelected(result.addresses.startup.toBase58());
      setView("overview");
      return result.signatures;
    });

  const handleResumeStartup = (startup: StartupData) =>
    run(async () => {
      setStep("Resuming incomplete startup lifecycle");
      const result = await resumeStartup(
        signer!,
        startup,
        setStep,
        applyPhase,
        trackSignature,
        recordTransaction,
      );
      setSelected(result.addresses.startup.toBase58());
      return result.signatures;
    });

  const handleLookupStartup = async (query: string) => {
    const found = await fetchStartupByAddressOrMint(query);
    if (!found) {
      throw new Error(
        "No ATTENZA startup found matching that Startup PDA or Mint address.",
      );
    }
    setDiscoveredStartups((prev) =>
      prev.some((item) => item.address.equals(found.address))
        ? prev
        : [found, ...prev],
    );
    setSelected(found.address.toBase58());
  };

  const handleCreateSchedule = (input: VestingSubmitInput) =>
    run(async () => {
      const beneficiaryKey = parsePublicKey(input.beneficiary);
      const id = startupIdBytes(input.scheduleId);
      const amount = toBaseUnits(input.amount, input.startup.ledger.decimals);
      const availableLocked =
        uint(input.startup.ledger.allocations.lockedReserve) -
        uint(input.startup.ledger.lockedAmountAssigned);
      if (amount > availableLocked) {
        throw new Error(
          "Schedule amount exceeds the remaining locked reserve.",
        );
      }
      const start = Math.floor(new Date(input.startTime).getTime() / 1000);
      const cliff = Math.floor(new Date(input.cliffTime).getTime() / 1000);
      const end = Math.floor(new Date(input.endTime).getTime() / 1000);
      if (!(
        start >= 0 &&
        start < end &&
        cliff >= start &&
        cliff <= end &&
        amount > 0n
      )) {
        throw new Error(
          "Schedule must have a positive amount and valid start, cliff, and end times.",
        );
      }
      setStep("Creating vesting schedule");
      const created = await createSchedule(
        signer!,
        input.startup.address,
        Uint8Array.from(input.startup.config.startupId),
        {
          scheduleId: id,
          beneficiary: beneficiaryKey,
          amount,
          start,
          cliff,
          end,
        },
        applyPhase,
        trackSignature,
        recordTransaction,
      );
      setStep("Activating vesting schedule");
      const activated = await activateSchedule(
        signer!,
        input.startup.address,
        created.schedule,
        Uint8Array.from(input.startup.config.startupId),
        applyPhase,
        trackSignature,
        recordTransaction,
      );
      return [created.signature, activated];
    });

  const handleActivateSchedule = (schedule: ScheduleData) =>
    run(async () => {
      setStep("Activating vesting schedule");
      const sig = await activateSchedule(
        signer!,
        schedule.data.startup,
        schedule.address,
        Uint8Array.from(schedule.data.startupId),
        applyPhase,
        trackSignature,
        recordTransaction,
      );
      return [sig];
    });

  const handleClaimSchedule = (schedule: ScheduleData) =>
    run(async () => {
      requireBeneficiaryWallet(publicKey, schedule.data.beneficiary);
      setStep("Checking vesting eligibility and beneficiary account");
      const claimData = calcVesting(
        uint(schedule.data.totalLocked),
        uint(schedule.data.claimed),
        uint(schedule.data.startTs),
        uint(schedule.data.cliffTs),
        uint(schedule.data.endTs),
        BigInt(Math.floor(Date.now() / 1000)),
      );
      if (!claimData.claimable) {
        throw new Error(
          "This schedule has no newly vested tokens available to claim.",
        );
      }
      const result = await claimSchedule(
        signer!,
        schedule.address,
        new PublicKey(schedule.data.mint),
        applyPhase,
        trackSignature,
        recordTransaction,
      );
      return [result.signature];
    });

  return (
    <main className="shell">
      <TopBar
        connected={connected}
        walletAddress={publicKey?.toBase58() ?? null}
      />

      <section className="hero">
        <div>
          <div className="eyebrow">M2.5 · Fixed supply, visible onchain</div>
          <h1>
            Attention, accounted
            <br />
            for onchain.
          </h1>
          <p className="sub">
            Create and inspect startup token allocations, then manage
            beneficiary locked reserves through the ATTENZA lifecycle program.
          </p>
        </div>
        <div className="heroaside">
          DEMO ENVIRONMENT
          <br />
          <span className="mono">Anchor · SPL Token · Solana</span>
          <br />
          No swaps or market activity
        </div>
      </section>

      <div className="notice">
        <strong>
          {CLUSTER === "devnet" ? "DEVNET TEST ASSETS" : "LOCALNET DEVELOPMENT"}
        </strong>
        <span>
          Tokens and SOL shown here have no monetary value. ATTENZA M2.5 does
          not support buying, selling, swaps, or liquidity.
        </span>
      </div>

      <NetworkStats
        rpcVerified={rpcVerified}
        balance={balance}
        connected={connected}
        managedCount={startups.length}
        discoveredCount={discoveredStartups.length}
        programReady={programReady}
      />

      <nav className="tabs" aria-label="Workspace views">
        {(["overview", "create", "vesting"] as View[]).map((item) => (
          <button
            type="button"
            key={item}
            className={`tab ${view === item ? "active" : ""}`}
            onClick={() => setView(item)}
          >
            {item === "overview"
              ? "Overview"
              : item === "create"
                ? "Create startup token"
                : "Vesting"}
          </button>
        ))}
      </nav>

      <StatusBanner
        error={error}
        notice={notice}
        signatures={signatures}
        phase={phase}
        busy={busy}
        onDismissError={() => setError("")}
        onDismissNotice={() => setNotice("")}
      />

      {view === "overview" && (
        <StartupOverview
          connected={connected}
          walletKey={publicKey}
          startups={startups}
          discoveredStartups={discoveredStartups}
          current={current}
          selected={selected}
          onSelect={setSelected}
          history={history}
          isRefreshing={isRefreshing}
          busy={busy}
          onRefresh={() => void refresh()}
          onNavigateCreate={() => setView("create")}
          onResumeStartup={handleResumeStartup}
          onLookupStartup={handleLookupStartup}
        />
      )}

      {view === "create" && (
        <CreateStartupWizard
          connected={connected}
          publicKey={publicKey}
          rpcVerified={rpcVerified}
          programReady={programReady}
          busy={busy}
          step={step}
          phase={phase}
          signatures={signatures}
          startups={startups}
          onCancel={() => setView("overview")}
          onJumpToStartup={(startupAddr) => {
            setSelected(startupAddr);
            setView("overview");
          }}
          onReportError={setError}
          onSubmit={handleCreateStartup}
        />
      )}

      {view === "vesting" && (
        <VestingManager
          connected={connected}
          publicKey={publicKey}
          programReady={programReady}
          rpcVerified={rpcVerified}
          busy={busy}
          isRefreshing={isRefreshing}
          startups={startups}
          discoveredStartups={discoveredStartups}
          current={current}
          onSelectStartup={setSelected}
          schedules={schedules}
          now={now}
          onRefresh={() => void refresh()}
          onCreateSchedule={handleCreateSchedule}
          onActivateSchedule={handleActivateSchedule}
          onClaimSchedule={handleClaimSchedule}
          onReportError={setError}
        />
      )}

      <footer className="footer">
        <div>
          ATTENZA M2.5 ·{" "}
          {CLUSTER === "devnet" ? "Devnet demonstration" : "Localnet mode"} · no
          financial value · no marketplace trading
        </div>
        <div>
          Program{" "}
          <a
            className="mono"
            href={EXPLORER(PROGRAM_ID.toBase58())}
            target="_blank"
            rel="noreferrer"
          >
            {shorten(PROGRAM_ID.toBase58(), 8, 7)} ↗
          </a>{" "}
          ·{" "}
          <a className="mono" href={RPC_URL}>
            {CLUSTER === "devnet" ? "Devnet RPC" : "Local RPC"}
          </a>
        </div>
      </footer>
    </main>
  );
}
