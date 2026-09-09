#!/bin/bash
# Altcoinchain Staking Test Script
# Tests the hybrid PoW/PoS staking functionality

RPC_URL="http://127.0.0.1:8545"
STAKING_CONTRACT="0x0000000000000000000000000000000000001000"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${GREEN}[Test]${NC} $1"; }
warn() { echo -e "${YELLOW}[Warning]${NC} $1"; }
error() { echo -e "${RED}[Error]${NC} $1"; }
info() { echo -e "${CYAN}[Info]${NC} $1"; }

# RPC helper
rpc_call() {
    curl -s -X POST -H "Content-Type: application/json" --data "$1" $RPC_URL
}

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           ALTCOINCHAIN STAKING TEST                       ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if node is running
BLOCK=$(rpc_call '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | grep -oP '"result":"0x\K[^"]+')
if [ -z "$BLOCK" ]; then
    error "Testnet node not running. Start it with ./start-testnet.sh"
    exit 1
fi
BLOCK_DEC=$((16#$BLOCK))
log "Current block: $BLOCK_DEC"

# Step 1: Create a test account
log "Step 1: Creating test account..."
ACCOUNT_RESULT=$(rpc_call '{"jsonrpc":"2.0","method":"personal_newAccount","params":["testpassword"],"id":1}')
ACCOUNT=$(echo $ACCOUNT_RESULT | grep -oP '"result":"\K[^"]+')

if [ -z "$ACCOUNT" ]; then
    # Try to list existing accounts
    ACCOUNTS_RESULT=$(rpc_call '{"jsonrpc":"2.0","method":"eth_accounts","params":[],"id":1}')
    ACCOUNT=$(echo $ACCOUNTS_RESULT | grep -oP '"result":\["\K[^"]+')
fi

if [ -z "$ACCOUNT" ]; then
    error "Could not create or find account"
    exit 1
fi
info "Test account: $ACCOUNT"

# Step 2: Check account balance
log "Step 2: Checking account balance..."
BALANCE_HEX=$(rpc_call "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$ACCOUNT\",\"latest\"],\"id\":1}" | grep -oP '"result":"\K[^"]+')
BALANCE_WEI=$((16#${BALANCE_HEX:2}))
info "Balance: $BALANCE_WEI wei"

# If balance is 0, need to mine some blocks first
if [ "$BALANCE_WEI" = "0" ]; then
    log "Account has no balance. Setting up mining..."

    # Set etherbase to our account
    rpc_call "{\"jsonrpc\":\"2.0\",\"method\":\"miner_setEtherbase\",\"params\":[\"$ACCOUNT\"],\"id\":1}"

    # Unlock account
    rpc_call "{\"jsonrpc\":\"2.0\",\"method\":\"personal_unlockAccount\",\"params\":[\"$ACCOUNT\",\"testpassword\",0],\"id\":1}"

    # Start mining
    log "Mining blocks to get balance..."
    rpc_call '{"jsonrpc":"2.0","method":"miner_start","params":[1],"id":1}'

    # Wait for some blocks
    for i in {1..30}; do
        BALANCE_HEX=$(rpc_call "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$ACCOUNT\",\"latest\"],\"id\":1}" | grep -oP '"result":"\K[^"]+')
        if [ "$BALANCE_HEX" != "0x0" ]; then
            break
        fi
        sleep 2
    done

    # Check new balance
    BALANCE_RESULT=$(rpc_call "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$ACCOUNT\",\"latest\"],\"id\":1}")
    info "New balance result: $BALANCE_RESULT"
fi

# Step 3: Check current block (should be past hybrid fork at block 10)
log "Step 3: Checking if past hybrid fork..."
BLOCK=$(rpc_call '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | grep -oP '"result":"0x\K[^"]+')
BLOCK_DEC=$((16#$BLOCK))
if [ $BLOCK_DEC -lt 10 ]; then
    info "Waiting for hybrid fork (block 10)... Currently at $BLOCK_DEC"
    while [ $BLOCK_DEC -lt 15 ]; do
        sleep 2
        BLOCK=$(rpc_call '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | grep -oP '"result":"0x\K[^"]+')
        BLOCK_DEC=$((16#$BLOCK))
        echo -ne "\rBlock: $BLOCK_DEC / 15"
    done
    echo ""
fi
log "Past hybrid fork - Block: $BLOCK_DEC"

# Step 4: Check staking contract
log "Step 4: Checking staking contract..."
CONTRACT_CODE=$(rpc_call "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getCode\",\"params\":[\"$STAKING_CONTRACT\",\"latest\"],\"id\":1}" | grep -oP '"result":"\K[^"]+')
if [ "$CONTRACT_CODE" = "0x" ] || [ -z "$CONTRACT_CODE" ]; then
    error "Staking contract not deployed!"
    exit 1
fi
CODE_LEN=${#CONTRACT_CODE}
info "Staking contract deployed (code length: $CODE_LEN bytes)"

# Step 5: Check total staked (should be 0)
log "Step 5: Checking total staked..."
# totalStaked() selector: 0x817b1cd2
TOTAL_STAKED=$(rpc_call "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"$STAKING_CONTRACT\",\"data\":\"0x817b1cd2\"},\"latest\"],\"id\":1}" | grep -oP '"result":"\K[^"]+')
info "Total staked: $TOTAL_STAKED"

# Step 6: Stake 32 ALT
log "Step 6: Staking 32 ALT..."
# Unlock account first
rpc_call "{\"jsonrpc\":\"2.0\",\"method\":\"personal_unlockAccount\",\"params\":[\"$ACCOUNT\",\"testpassword\",300],\"id\":1}"

# stake() selector: 0x3a4b66f1
# 32 ALT = 32 * 10^18 = 0x1bc16d674ec800000
STAKE_TX=$(rpc_call "{\"jsonrpc\":\"2.0\",\"method\":\"eth_sendTransaction\",\"params\":[{\"from\":\"$ACCOUNT\",\"to\":\"$STAKING_CONTRACT\",\"data\":\"0x3a4b66f1\",\"value\":\"0x1bc16d674ec800000\",\"gas\":\"0x100000\"}],\"id\":1}")
TX_HASH=$(echo $STAKE_TX | grep -oP '"result":"\K[^"]+')

if [ -z "$TX_HASH" ]; then
    warn "Stake transaction may have failed: $STAKE_TX"
else
    info "Stake TX: $TX_HASH"

    # Wait for transaction to be mined
    log "Waiting for transaction to be mined..."
    for i in {1..30}; do
        RECEIPT=$(rpc_call "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getTransactionReceipt\",\"params\":[\"$TX_HASH\"],\"id\":1}")
        if echo $RECEIPT | grep -q '"status":"0x1"'; then
            info "Transaction successful!"
            break
        elif echo $RECEIPT | grep -q '"status":"0x0"'; then
            error "Transaction failed!"
            break
        fi
        sleep 2
    done
fi

# Step 7: Check if we're now a validator
log "Step 7: Checking validator status..."
# isValidator(address) selector: 0xfacd743b + address padded
ADDR_PADDED=$(echo $ACCOUNT | sed 's/0x/000000000000000000000000/')
IS_VALIDATOR=$(rpc_call "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"$STAKING_CONTRACT\",\"data\":\"0xfacd743b$ADDR_PADDED\"},\"latest\"],\"id\":1}" | grep -oP '"result":"\K[^"]+')
if [ "$IS_VALIDATOR" = "0x0000000000000000000000000000000000000000000000000000000000000001" ]; then
    log "SUCCESS: Account is now a validator!"
else
    warn "Account is not a validator yet: $IS_VALIDATOR"
fi

# Step 8: Check total staked again
log "Step 8: Checking total staked after staking..."
TOTAL_STAKED=$(rpc_call "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"$STAKING_CONTRACT\",\"data\":\"0x817b1cd2\"},\"latest\"],\"id\":1}" | grep -oP '"result":"\K[^"]+')
STAKED_DEC=$((16#${TOTAL_STAKED:2}))
STAKED_ALT=$(echo "scale=2; $STAKED_DEC / 1000000000000000000" | bc 2>/dev/null || echo "$STAKED_DEC wei")
info "Total staked: $STAKED_ALT ALT"

# Step 9: Check validator count
log "Step 9: Checking validator count..."
# getValidatorCount() selector: 0x7071688a
VALIDATOR_COUNT=$(rpc_call "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"$STAKING_CONTRACT\",\"data\":\"0x7071688a\"},\"latest\"],\"id\":1}" | grep -oP '"result":"\K[^"]+')
COUNT_DEC=$((16#${VALIDATOR_COUNT:2}))
info "Validator count: $COUNT_DEC"

# Step 10: Mine more blocks to accumulate rewards
log "Step 10: Mining blocks to accumulate staking rewards..."
START_BLOCK=$BLOCK_DEC
info "Mining 10 more blocks..."
for i in {1..20}; do
    sleep 2
    BLOCK=$(rpc_call '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | grep -oP '"result":"0x\K[^"]+')
    BLOCK_DEC=$((16#$BLOCK))
    if [ $((BLOCK_DEC - START_BLOCK)) -ge 10 ]; then
        break
    fi
done
info "Now at block $BLOCK_DEC"

# Step 11: Check pending rewards
log "Step 11: Checking pending rewards..."
# getPendingRewards(address) selector: 0xf6ed2017
PENDING=$(rpc_call "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"$STAKING_CONTRACT\",\"data\":\"0xf6ed2017$ADDR_PADDED\"},\"latest\"],\"id\":1}" | grep -oP '"result":"\K[^"]+')
PENDING_DEC=$((16#${PENDING:2}))
PENDING_ALT=$(echo "scale=6; $PENDING_DEC / 1000000000000000000" | bc 2>/dev/null || echo "$PENDING_DEC wei")
info "Pending rewards: $PENDING_ALT ALT"

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}STAKING TEST SUMMARY${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo "Test Account:     $ACCOUNT"
echo "Staking Contract: $STAKING_CONTRACT"
echo "Current Block:    $BLOCK_DEC"
echo "Total Staked:     $STAKED_ALT ALT"
echo "Validator Count:  $COUNT_DEC"
echo "Pending Rewards:  $PENDING_ALT ALT"
echo ""
if [ "$COUNT_DEC" -gt 0 ]; then
    echo -e "${GREEN}✓ Staking is working!${NC}"
else
    echo -e "${YELLOW}⚠ Staking may need more testing${NC}"
fi
echo ""
log "Test complete. Check logs: tail -f ~/.altcoinchain-testnet/testnet.log"
