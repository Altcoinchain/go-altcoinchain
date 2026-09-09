const https = require('https');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const RPC_URL = 'https://alt-rpc2.minethepla.net';
const LOCAL_RPC = 'http://127.0.0.1:8545';
const DEPLOYER = '0xc1bf191c4766d9501f2ddfd58ac09bfd826ef146';
const PASSWORD = 'altcoinchain2330';
const BYTECODE = '0x' + fs.readFileSync('./build/ValidatorStaking.bin', 'utf8').trim();

async function rpcCall(url, method, params) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            jsonrpc: '2.0',
            method: method,
            params: params,
            id: 1
        });

        const isHttps = url.startsWith('https');
        const urlObj = new URL(url);

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = (isHttps ? https : http).request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    if (json.error) reject(new Error(json.error.message));
                    else resolve(json.result);
                } catch(e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function deploy() {
    console.log('Deploying ValidatorStaking contract...');
    console.log('RPC:', RPC_URL);
    console.log('Deployer:', DEPLOYER);

    // Get nonce from mainnet
    const nonce = await rpcCall(RPC_URL, 'eth_getTransactionCount', [DEPLOYER, 'latest']);
    console.log('Nonce:', nonce);

    // Get gas price
    const gasPrice = await rpcCall(RPC_URL, 'eth_gasPrice', []);
    console.log('Gas Price:', gasPrice);

    // Get chain ID
    const chainId = await rpcCall(RPC_URL, 'eth_chainId', []);
    console.log('Chain ID:', chainId);

    // Unlock account on local node
    console.log('Unlocking account...');
    await rpcCall(LOCAL_RPC, 'personal_unlockAccount', [DEPLOYER, PASSWORD, 300]);

    // Estimate gas
    console.log('Estimating gas...');
    let gasEstimate;
    try {
        gasEstimate = await rpcCall(RPC_URL, 'eth_estimateGas', [{
            from: DEPLOYER,
            data: BYTECODE
        }]);
    } catch(e) {
        console.log('Gas estimation failed, using default');
        gasEstimate = '0x300000'; // 3M gas
    }
    console.log('Gas Estimate:', gasEstimate);

    // Create and sign transaction on local node
    console.log('Signing transaction...');
    const tx = {
        from: DEPLOYER,
        data: BYTECODE,
        gas: gasEstimate,
        gasPrice: gasPrice,
        nonce: nonce
    };

    const signedTx = await rpcCall(LOCAL_RPC, 'eth_signTransaction', [tx]);
    console.log('Transaction signed');

    // Broadcast to mainnet
    console.log('Broadcasting to mainnet...');
    const txHash = await rpcCall(RPC_URL, 'eth_sendRawTransaction', [signedTx.raw]);
    console.log('Transaction Hash:', txHash);

    // Wait for receipt
    console.log('Waiting for confirmation...');
    let receipt = null;
    for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 2000));
        receipt = await rpcCall(RPC_URL, 'eth_getTransactionReceipt', [txHash]);
        if (receipt) break;
        process.stdout.write('.');
    }

    if (receipt) {
        console.log('\n\nContract deployed!');
        console.log('Contract Address:', receipt.contractAddress);
        console.log('Block Number:', parseInt(receipt.blockNumber, 16));
        console.log('Gas Used:', parseInt(receipt.gasUsed, 16));
    } else {
        console.log('\nTransaction pending, check hash:', txHash);
    }
}

deploy().catch(console.error);
