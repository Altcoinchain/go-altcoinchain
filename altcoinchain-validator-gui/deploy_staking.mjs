import { ethers } from 'ethers';
import fs from 'fs';

async function main() {
    const provider = new ethers.JsonRpcProvider('http://localhost:8545');
    const bytecode = '0x' + fs.readFileSync('/tmp/staking_compiled/ValidatorStaking.bin', 'utf8').trim();
    
    // Get accounts from dev chain
    const accounts = await provider.send('eth_accounts', []);
    console.log('Dev accounts:', accounts);
    
    const signer = await provider.getSigner(accounts[0]);
    console.log('Deploying from:', await signer.getAddress());
    
    // Create contract factory
    const factory = new ethers.ContractFactory([], bytecode, signer);
    
    console.log('Deploying ValidatorStaking contract...');
    const contract = await factory.deploy();
    await contract.waitForDeployment();
    
    const address = await contract.getAddress();
    console.log('Contract deployed at:', address);
}

main().catch(console.error);
