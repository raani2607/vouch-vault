/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/vouchvault_token.json`.
 */
export type VouchvaultToken = {
  address: "3RV7NRVSTabzrkuKywR3YNXazG8JSJcDo1v6BbD9Nwet";
  metadata: {
    name: "vouchvaultToken";
    version: "0.1.0";
    spec: "0.1.0";
  };
  instructions: [
    {
      name: "activateVestingSchedule";
      discriminator: [203, 15, 249, 2, 34, 171, 253, 14];
      accounts: [
        {
          name: "startupAuthority";
          signer: true;
        },
        {
          name: "startupConfig";
        },
        {
          name: "vestingSchedule";
          writable: true;
        },
      ];
      args: [];
    },
    {
      name: "claimVested";
      discriminator: [208, 190, 166, 114, 203, 225, 140, 208];
      accounts: [
        {
          name: "beneficiary";
          writable: true;
          signer: true;
        },
        {
          name: "vestingSchedule";
          writable: true;
        },
        {
          name: "escrow";
          writable: true;
        },
        {
          name: "beneficiaryTokenAccount";
          writable: true;
        },
        {
          name: "mint";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [];
    },
    {
      name: "createAllocationVault";
      discriminator: [14, 38, 250, 75, 9, 154, 140, 32];
      accounts: [
        {
          name: "startupAuthority";
          writable: true;
          signer: true;
        },
        {
          name: "startupConfig";
          writable: true;
        },
        {
          name: "allocationLedger";
          writable: true;
        },
        {
          name: "vaultAuthority";
        },
        {
          name: "mint";
        },
        {
          name: "vault";
          writable: true;
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "rent";
          address: "SysvarRent111111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "bucket";
          type: {
            defined: {
              name: "allocationBucket";
            };
          };
        },
      ];
    },
    {
      name: "createVestingSchedule";
      discriminator: [195, 30, 184, 253, 77, 154, 187, 66];
      accounts: [
        {
          name: "startupAuthority";
          writable: true;
          signer: true;
        },
        {
          name: "startupConfig";
          writable: true;
        },
        {
          name: "allocationLedger";
          writable: true;
        },
        {
          name: "vaultAuthority";
        },
        {
          name: "mint";
        },
        {
          name: "lockedReserveVault";
          writable: true;
        },
        {
          name: "vestingSchedule";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 101, 115, 116, 105, 110, 103];
              },
              {
                kind: "account";
                path: "startupConfig";
              },
              {
                kind: "arg";
                path: "scheduleId";
              },
            ];
          };
        },
        {
          name: "beneficiary";
        },
        {
          name: "escrow";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  118,
                  101,
                  115,
                  116,
                  105,
                  110,
                  103,
                  45,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119,
                ];
              },
              {
                kind: "account";
                path: "startupConfig";
              },
              {
                kind: "arg";
                path: "scheduleId";
              },
            ];
          };
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "rent";
          address: "SysvarRent111111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "scheduleId";
          type: {
            array: ["u8", 32];
          };
        },
        {
          name: "amount";
          type: "u64";
        },
        {
          name: "startTs";
          type: "i64";
        },
        {
          name: "cliffTs";
          type: "i64";
        },
        {
          name: "endTs";
          type: "i64";
        },
      ];
    },
    {
      name: "finalizeStartup";
      discriminator: [8, 46, 173, 0, 87, 129, 178, 89];
      accounts: [
        {
          name: "startupAuthority";
          writable: true;
          signer: true;
        },
        {
          name: "startupConfig";
          writable: true;
        },
        {
          name: "allocationLedger";
          writable: true;
        },
        {
          name: "mintAuthority";
        },
        {
          name: "mint";
          writable: true;
        },
        {
          name: "marketVault";
        },
        {
          name: "startupReserveVault";
        },
        {
          name: "communityReserveVault";
        },
        {
          name: "lockedReserveVault";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "clock";
          address: "SysvarC1ock11111111111111111111111111111111";
        },
      ];
      args: [];
    },
    {
      name: "fundAllocations";
      discriminator: [150, 106, 124, 75, 134, 232, 63, 59];
      accounts: [
        {
          name: "startupAuthority";
          writable: true;
          signer: true;
        },
        {
          name: "startupConfig";
          writable: true;
        },
        {
          name: "allocationLedger";
          writable: true;
        },
        {
          name: "mintAuthority";
        },
        {
          name: "mint";
          writable: true;
        },
        {
          name: "marketVault";
          writable: true;
        },
        {
          name: "startupReserveVault";
          writable: true;
        },
        {
          name: "communityReserveVault";
          writable: true;
        },
        {
          name: "lockedReserveVault";
          writable: true;
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [];
    },
    {
      name: "initializeStartup";
      discriminator: [205, 176, 227, 193, 94, 24, 25, 40];
      accounts: [
        {
          name: "startupAuthority";
          writable: true;
          signer: true;
        },
        {
          name: "startupConfig";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [115, 116, 97, 114, 116, 117, 112];
              },
              {
                kind: "account";
                path: "startupAuthority";
              },
              {
                kind: "arg";
                path: "startupId";
              },
            ];
          };
        },
        {
          name: "allocationLedger";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [97, 108, 108, 111, 99, 97, 116, 105, 111, 110];
              },
              {
                kind: "account";
                path: "startupAuthority";
              },
              {
                kind: "arg";
                path: "startupId";
              },
            ];
          };
        },
        {
          name: "mintAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  109,
                  105,
                  110,
                  116,
                  45,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
              {
                kind: "account";
                path: "startupAuthority";
              },
              {
                kind: "arg";
                path: "startupId";
              },
            ];
          };
        },
        {
          name: "mint";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [109, 105, 110, 116];
              },
              {
                kind: "account";
                path: "startupAuthority";
              },
              {
                kind: "arg";
                path: "startupId";
              },
            ];
          };
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "rent";
          address: "SysvarRent111111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "startupId";
          type: {
            array: ["u8", 32];
          };
        },
        {
          name: "totalSupply";
          type: "u64";
        },
        {
          name: "decimals";
          type: "u8";
        },
        {
          name: "allocations";
          type: {
            defined: {
              name: "allocationAmounts";
            };
          };
        },
      ];
    },
  ];
  accounts: [
    {
      name: "allocationLedger";
      discriminator: [53, 81, 62, 163, 68, 200, 187, 50];
    },
    {
      name: "startupConfig";
      discriminator: [45, 52, 20, 4, 50, 98, 169, 82];
    },
    {
      name: "vestingSchedule";
      discriminator: [130, 200, 173, 148, 39, 75, 243, 147];
    },
  ];
  events: [
    {
      name: "allocationVaultCreated";
      discriminator: [211, 159, 42, 143, 25, 116, 249, 6];
    },
    {
      name: "allocationsFunded";
      discriminator: [121, 218, 218, 42, 249, 90, 28, 161];
    },
    {
      name: "startupTokenCreated";
      discriminator: [219, 61, 123, 167, 172, 65, 162, 138];
    },
    {
      name: "tokenInitializationFinalized";
      discriminator: [61, 230, 198, 176, 195, 230, 164, 255];
    },
    {
      name: "vestingClaimed";
      discriminator: [166, 62, 135, 158, 137, 1, 85, 15];
    },
    {
      name: "vestingScheduleActivated";
      discriminator: [157, 197, 89, 145, 189, 147, 168, 210];
    },
    {
      name: "vestingScheduleCreated";
      discriminator: [234, 207, 231, 98, 6, 142, 111, 165];
    },
  ];
  errors: [
    {
      code: 6000;
      name: "invalidSupply";
      msg: "Supply must be greater than zero.";
    },
    {
      code: 6001;
      name: "invalidDecimals";
      msg: "Decimals must be at most nine.";
    },
    {
      code: 6002;
      name: "allocationMismatch";
      msg: "Allocations must equal total supply exactly.";
    },
    {
      code: 6003;
      name: "arithmetic";
      msg: "Checked arithmetic failed.";
    },
    {
      code: 6004;
      name: "invalidState";
      msg: "Instruction is invalid in the current state.";
    },
    {
      code: 6005;
      name: "vaultAlreadyCreated";
      msg: "Allocation vault already exists.";
    },
    {
      code: 6006;
      name: "vaultsIncomplete";
      msg: "All four vaults must exist before funding.";
    },
    {
      code: 6007;
      name: "mintStateInvalid";
      msg: "Mint authority or initial supply is invalid.";
    },
    {
      code: 6008;
      name: "supplyMismatch";
      msg: "Mint supply differs from declared supply.";
    },
    {
      code: 6009;
      name: "vaultBalanceMismatch";
      msg: "Vault balance differs from allocation.";
    },
    {
      code: 6010;
      name: "freezeAuthorityPresent";
      msg: "Mint freeze authority must be absent.";
    },
    {
      code: 6011;
      name: "invalidSchedule";
      msg: "Vesting timestamps are invalid.";
    },
    {
      code: 6012;
      name: "lockedReserveAssigned";
      msg: "Locked reserve has already been assigned.";
    },
    {
      code: 6013;
      name: "scheduleAlreadyActive";
      msg: "Schedule is already active.";
    },
    {
      code: 6014;
      name: "scheduleNotActive";
      msg: "Schedule is not active.";
    },
    {
      code: 6015;
      name: "unauthorizedBeneficiary";
      msg: "Only the beneficiary may claim.";
    },
    {
      code: 6016;
      name: "nothingToClaim";
      msg: "No additional amount is vested.";
    },
    {
      code: 6017;
      name: "timestamp";
      msg: "Timestamp is outside the valid range.";
    },
  ];
  types: [
    {
      name: "allocationAmounts";
      type: {
        kind: "struct";
        fields: [
          {
            name: "marketInventory";
            type: "u64";
          },
          {
            name: "startupReserve";
            type: "u64";
          },
          {
            name: "communityReserve";
            type: "u64";
          },
          {
            name: "lockedReserve";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "allocationBucket";
      type: {
        kind: "enum";
        variants: [
          {
            name: "marketInventory";
          },
          {
            name: "startupReserve";
          },
          {
            name: "communityReserve";
          },
          {
            name: "lockedReserve";
          },
        ];
      };
    },
    {
      name: "allocationLedger";
      type: {
        kind: "struct";
        fields: [
          {
            name: "startup";
            type: "pubkey";
          },
          {
            name: "createdBy";
            type: "pubkey";
          },
          {
            name: "totalSupply";
            type: "u64";
          },
          {
            name: "decimals";
            type: "u8";
          },
          {
            name: "allocations";
            type: {
              defined: {
                name: "allocationAmounts";
              };
            };
          },
          {
            name: "vaults";
            type: {
              array: ["pubkey", 4];
            };
          },
          {
            name: "vaultMask";
            type: "u8";
          },
          {
            name: "lockedAmountAssigned";
            type: "u64";
          },
          {
            name: "finalizedAt";
            type: "i64";
          },
          {
            name: "bump";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "allocationVaultCreated";
      type: {
        kind: "struct";
        fields: [
          {
            name: "startup";
            type: "pubkey";
          },
          {
            name: "bucket";
            type: {
              defined: {
                name: "allocationBucket";
              };
            };
          },
          {
            name: "vault";
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "allocationsFunded";
      type: {
        kind: "struct";
        fields: [
          {
            name: "startup";
            type: "pubkey";
          },
          {
            name: "mint";
            type: "pubkey";
          },
          {
            name: "totalSupply";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "lifecycleState";
      type: {
        kind: "enum";
        variants: [
          {
            name: "created";
          },
          {
            name: "funded";
          },
          {
            name: "finalized";
          },
        ];
      };
    },
    {
      name: "startupConfig";
      type: {
        kind: "struct";
        fields: [
          {
            name: "startupId";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "authority";
            type: "pubkey";
          },
          {
            name: "mint";
            type: "pubkey";
          },
          {
            name: "state";
            type: {
              defined: {
                name: "lifecycleState";
              };
            };
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "authorityBump";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "startupTokenCreated";
      type: {
        kind: "struct";
        fields: [
          {
            name: "startupId";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "startup";
            type: "pubkey";
          },
          {
            name: "mint";
            type: "pubkey";
          },
          {
            name: "totalSupply";
            type: "u64";
          },
          {
            name: "decimals";
            type: "u8";
          },
          {
            name: "authority";
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "tokenInitializationFinalized";
      type: {
        kind: "struct";
        fields: [
          {
            name: "startupId";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "startup";
            type: "pubkey";
          },
          {
            name: "mint";
            type: "pubkey";
          },
          {
            name: "totalSupply";
            type: "u64";
          },
          {
            name: "finalizedAt";
            type: "i64";
          },
        ];
      };
    },
    {
      name: "vestingClaimed";
      type: {
        kind: "struct";
        fields: [
          {
            name: "startupId";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "schedule";
            type: "pubkey";
          },
          {
            name: "beneficiary";
            type: "pubkey";
          },
          {
            name: "amountClaimed";
            type: "u64";
          },
          {
            name: "cumulativeClaimed";
            type: "u64";
          },
          {
            name: "remainingLocked";
            type: "u64";
          },
          {
            name: "timestamp";
            type: "i64";
          },
        ];
      };
    },
    {
      name: "vestingSchedule";
      type: {
        kind: "struct";
        fields: [
          {
            name: "startup";
            type: "pubkey";
          },
          {
            name: "startupId";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "scheduleId";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "beneficiary";
            type: "pubkey";
          },
          {
            name: "mint";
            type: "pubkey";
          },
          {
            name: "escrow";
            type: "pubkey";
          },
          {
            name: "totalLocked";
            type: "u64";
          },
          {
            name: "startTs";
            type: "i64";
          },
          {
            name: "cliffTs";
            type: "i64";
          },
          {
            name: "endTs";
            type: "i64";
          },
          {
            name: "claimed";
            type: "u64";
          },
          {
            name: "active";
            type: "bool";
          },
          {
            name: "bump";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "vestingScheduleActivated";
      type: {
        kind: "struct";
        fields: [
          {
            name: "startupId";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "schedule";
            type: "pubkey";
          },
          {
            name: "beneficiary";
            type: "pubkey";
          },
          {
            name: "totalLocked";
            type: "u64";
          },
          {
            name: "startTs";
            type: "i64";
          },
          {
            name: "cliffTs";
            type: "i64";
          },
          {
            name: "endTs";
            type: "i64";
          },
        ];
      };
    },
    {
      name: "vestingScheduleCreated";
      type: {
        kind: "struct";
        fields: [
          {
            name: "startupId";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "schedule";
            type: "pubkey";
          },
          {
            name: "beneficiary";
            type: "pubkey";
          },
          {
            name: "mint";
            type: "pubkey";
          },
          {
            name: "escrow";
            type: "pubkey";
          },
          {
            name: "totalLocked";
            type: "u64";
          },
          {
            name: "startTs";
            type: "i64";
          },
          {
            name: "cliffTs";
            type: "i64";
          },
          {
            name: "endTs";
            type: "i64";
          },
        ];
      };
    },
  ];
};
