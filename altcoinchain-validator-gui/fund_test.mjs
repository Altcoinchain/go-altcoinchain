import { ethers } from 'ethers';

async function main() {
    const provider = new ethers.JsonRpcProvider('http://localhost:8545');
    
    // Test wallet private key from the GUI
    const testKey = '0x3303914214606d50a13dd1522208879a50b261a412433d05b11dff3f0bd00955';
    const testWallet = new ethers.Wallet(testKey);
    console.log('Test wallet address:', testWallet.address);
    
    // Get dev account balance
    const accounts = await provider.send('eth_accounts', []);
    const devSigner = await provider.getSigner(accounts[0]);
    
    // Send 100 ALT to test wallet
    console.log('Sending 100 ALT to test wallet...');
    const tx = await devSigner.sendTransaction({
        to: testWallet.address,
        value: ethers.parseEther('100')
    });
    await tx.wait();
    
    // Check balance
    const balance = await provider.getBalance(testWallet.address);
    console.log('Test wallet balance:', ethers.formatEther(balance), 'ALT');
}

main().catch(console.error);
