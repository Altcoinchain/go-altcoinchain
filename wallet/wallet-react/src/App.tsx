import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { QRCodeSVG } from 'qrcode.react';
import MatrixRain from './components/MatrixRain';
import Scanlines from './components/Scanlines';
import GlitchOverlay from './components/GlitchOverlay';
import WebGPUMiner from './components/WebGPUMiner';
import NativeMinerInstaller from './components/NativeMinerInstaller';
import {
  Wallet, Send, Download, Plus, Trash2, Copy, Eye, EyeOff,
  RefreshCw, Zap, Coins, Globe, Server, X, Check, AlertTriangle,
  ChevronRight, Database, Activity, Image, ArrowLeftRight, Search,
  ExternalLink, TrendingUp, TrendingDown, MoreHorizontal, Cpu, Play, Square,
  Sun, Moon, Monitor, Terminal, FileText, HelpCircle, Info, Settings, Users,
  Shield, Key, Lock, Upload, FolderOpen, ChevronDown
} from 'lucide-react';
import './index.css';

// Constants
const CHAIN_ID = 2330;
// Public Altcoinchain RPC (Cloudflare tunnel to the node; read-safe method filter).
// Overridable at runtime via window.__ALT_RPC__.
const RPC_URL = (typeof window !== 'undefined' && (window as any).__ALT_RPC__) || 'https://rpc.wattxchange.app';
// ValidatorStaking v2 (32 ALT minimum, authenticated attest()), deployed 2026-07-12.
const STAKING_CONTRACT = '0x347F496c887a92ed9706ff3EDF4f0b822Ab00d3E';
const MIN_STAKE = 32;
const TOKENS_STORAGE_KEY = 'altcoinchain_tokens';
const NFTS_STORAGE_KEY = 'altcoinchain_nfts';
const ADDRESSBOOK_STORAGE_KEY = 'altcoinchain_addressbook';
const NFT_COLLECTIONS_STORAGE_KEY = 'altcoinchain_nft_collections';

// Known tokens on Altcoinchain - these will be auto-scanned
const KNOWN_TOKENS: Token[] = [
  {
    address: '0x6645143e49B3a15d8F205658903a55E520444698',
    symbol: 'WATT',
    name: 'WATT Token',
    decimals: 18,
  }
];

// Default tokens to always show
const DEFAULT_TOKENS: Token[] = [...KNOWN_TOKENS];

// NFT Collection interface
interface NFTCollection {
  address: string;
  name: string;
  maxTokenId: number;
  type: 'ERC1155' | 'ERC721';
}

// Known NFT collections on Altcoinchain
const KNOWN_NFT_COLLECTIONS: NFTCollection[] = [
  {
    address: '0xf9670e5D46834561813CA79854B3d7147BBbFfb2',
    name: 'Mining Game',
    maxTokenId: 5,
    type: 'ERC1155'
  }
];

// NFT Staking contract
const NFT_STAKING_CONTRACT = '0xe463045318393095F11ed39f1a98332aBCc1A7b1';

// Mining Game NFT names by token ID
const MINING_GAME_NFT_NAMES: { [key: number]: string } = {
  1: 'Gaming PC',
  2: 'Genesis Badge',
  3: 'Kirtex XL1 CPU',
  4: 'Oblivia TX120 GPU',
  5: 'MAD GP50 GPU',
  6: 'Unknown Item'
};

// Mining Game NFT metadata (from archived api.mining.game)
const MINING_GAME_METADATA: { [key: number]: NFTMetadata } = {
  1: {
    name: 'Gaming PC',
    description: 'The basic PC needed to play the Mining Game. Free to mint!',
    image: 'https://web.archive.org/web/20220327074932/https://api.mining.game/1.png',
    external_url: 'https://mining.game/nfts/free/',
    attributes: [
      { trait_type: 'Brand', value: 'Minga' },
      { trait_type: 'Component', value: 'Basic PC' },
      { trait_type: 'Generation', value: 'Gen1' },
      { display_type: 'boost_number', trait_type: 'Mining Hashpower', value: 2 },
      { display_type: 'boost_number', trait_type: 'WATT Usage', value: 5 },
      { display_type: 'boost_number', trait_type: 'Stake Weight', value: 1 }
    ]
  },
  2: {
    name: 'Genesis Badge',
    description: 'The exclusive Genesis Badge, increasing luck and efficiency with 10%! Only 100 will ever be minted! This NFT receives Play to Earn Rewards.',
    image: 'https://web.archive.org/web/20250308122104/https://api.mining.game/2.png',
    external_url: 'https://mining.game/nfts/genesis-badge/',
    attributes: [
      { trait_type: 'Component', value: 'Badge' },
      { trait_type: 'Generation', value: 'Gen1' },
      { display_type: 'boost_percentage', trait_type: 'Luck Boost', value: 10 },
      { display_type: 'boost_percentage', trait_type: 'Efficiency Multiplier', value: 10 },
      { display_type: 'boost_number', trait_type: 'Stake Weight', value: 42 }
    ]
  },
  3: {
    name: 'XL1 Processor',
    description: 'CPU upgrade for your Gaming PC! This NFT receives Play to Earn Rewards.',
    image: 'https://web.archive.org/web/20250308122104/https://api.mining.game/3.png',
    external_url: 'https://mining.game/nfts/kirtex-xl1-cpu/',
    attributes: [
      { trait_type: 'Brand', value: 'Kirtex' },
      { trait_type: 'Component', value: 'Processor' },
      { trait_type: 'Generation', value: 'Gen1' },
      { display_type: 'boost_number', trait_type: 'Mining Hashpower', value: 10 },
      { display_type: 'boost_number', trait_type: 'WATT Usage', value: 2 },
      { display_type: 'boost_number', trait_type: 'Stake Weight', value: 9 }
    ]
  },
  4: {
    name: 'TX120 GPU',
    description: 'GPU upgrade for your Gaming PC! This NFT receives Play to Earn Rewards.',
    image: 'https://web.archive.org/web/20250308122106/https://api.mining.game/4.png',
    external_url: 'https://mining.game/nfts/oblivia-tx120-gpu/',
    attributes: [
      { trait_type: 'Brand', value: 'Oblivia' },
      { trait_type: 'Component', value: 'GPU' },
      { trait_type: 'Generation', value: 'Gen1' },
      { display_type: 'boost_number', trait_type: 'Mining Hashpower', value: 20 },
      { display_type: 'boost_number', trait_type: 'WATT Usage', value: 10 },
      { display_type: 'boost_number', trait_type: 'Stake Weight', value: 11 }
    ]
  },
  5: {
    name: 'GP50 GPU',
    description: 'A powerful GPU upgrade for your Gaming PC!',
    image: 'https://web.archive.org/web/20220418080358/https://api.mining.game/5.png',
    external_url: 'https://mining.game/mad-gp50-gpu/',
    attributes: [
      { trait_type: 'Brand', value: 'MAD' },
      { trait_type: 'Component', value: 'GPU' },
      { trait_type: 'Generation', value: 'Gen1' },
      { display_type: 'boost_number', trait_type: 'Mining Hashpower', value: 33 },
      { display_type: 'boost_number', trait_type: 'WATT Usage', value: 16 },
      { display_type: 'boost_number', trait_type: 'Stake Weight', value: 18 }
    ]
  }
};

// Default NFT collection
const DEFAULT_NFT_CONTRACT = '0xf9670e5D46834561813CA79854B3d7147BBbFfb2';
const DEFAULT_NFT_IDS = ['1', '2', '3', '4', '5', '6'];

// Types
interface WalletData {
  filename: string;
  address: string;
  name: string;
  keystore?: any;
}

interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance?: string;
  price?: number;
  change24h?: number;
  logo?: string;
}

interface NFTTrait {
  trait_type: string;
  value: string | number;
  display_type?: string;
}

interface NFTMetadata {
  name?: string;
  description?: string;
  image?: string;
  external_url?: string;
  attributes?: NFTTrait[];
  properties?: Record<string, any>;
}

interface NFT {
  address: string;
  tokenId: string;
  name: string;
  description?: string;
  image?: string;
  collection?: string;
  metadata?: NFTMetadata;
  balance?: number;
  stakedBalance?: number;
}

interface AddressBookEntry {
  address: string;
  name: string;
  label?: string;
  notes?: string;
  addedAt: number;
}

// ERC20 ABI for token interactions
const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)'
];

// ERC721 ABI for NFT interactions
const ERC721_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function balanceOf(address owner) view returns (uint256)'
];

// ERC1155 ABI for Mining Game NFTs
const ERC1155_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function uri(uint256 tokenId) view returns (string)',
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)'
];

// Electron API interface
declare global {
  interface Window {
    electronAPI?: {
      getWallets: () => Promise<WalletData[]>;
      saveWallet: (filename: string, content: any) => Promise<{success: boolean}>;
      loadWallet: (filename: string) => Promise<{success: boolean; content: any}>;
      deleteWallet: (filename: string) => Promise<{success: boolean}>;
      getTokens: () => Promise<Token[]>;
      saveTokens: (tokens: Token[]) => Promise<{success: boolean}>;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      openDataDir: () => void;
      getDataDir: () => Promise<string>;
      platform: string;
    };
  }
}

// LocalStorage fallback for browser mode
const WALLETS_STORAGE_KEY = 'altcoinchain_wallets';

const localStorageAPI = {
  getWallets: (): WalletData[] => {
    try {
      const data = localStorage.getItem(WALLETS_STORAGE_KEY);
      if (!data) return [];
      const wallets = JSON.parse(data);
      return wallets.map((w: any) => ({
        filename: w.filename,
        address: w.keystore?.address ? `0x${w.keystore.address}` : w.address,
        name: w.keystore?.name || w.name || 'Wallet',
        keystore: w.keystore
      }));
    } catch {
      return [];
    }
  },
  saveWallet: (filename: string, content: any): boolean => {
    try {
      const wallets = localStorageAPI.getWallets();
      const existing = wallets.findIndex(w => w.filename === filename);
      const walletData = {
        filename,
        address: content.address ? `0x${content.address}` : '',
        name: content.name || 'Wallet',
        keystore: content
      };
      if (existing >= 0) {
        wallets[existing] = walletData;
      } else {
        wallets.push(walletData);
      }
      // Store the full keystore data
      const storageData = wallets.map(w => ({
        filename: w.filename,
        address: w.address,
        name: w.name,
        keystore: w.keystore
      }));
      localStorage.setItem(WALLETS_STORAGE_KEY, JSON.stringify(storageData));
      return true;
    } catch {
      return false;
    }
  },
  loadWallet: (filename: string): { success: boolean; content: any } => {
    try {
      const data = localStorage.getItem(WALLETS_STORAGE_KEY);
      if (!data) return { success: false, content: null };
      const wallets = JSON.parse(data);
      const wallet = wallets.find((w: any) => w.filename === filename);
      if (wallet?.keystore) {
        return { success: true, content: wallet.keystore };
      }
      return { success: false, content: null };
    } catch {
      return { success: false, content: null };
    }
  },
  deleteWallet: (filename: string): boolean => {
    try {
      const wallets = localStorageAPI.getWallets().filter(w => w.filename !== filename);
      localStorage.setItem(WALLETS_STORAGE_KEY, JSON.stringify(wallets));
      return true;
    } catch {
      return false;
    }
  }
};

// Token localStorage API
const tokenStorageAPI = {
  getTokens: (): Token[] => {
    try {
      const data = localStorage.getItem(TOKENS_STORAGE_KEY);
      if (!data) {
        // Initialize with default tokens
        localStorage.setItem(TOKENS_STORAGE_KEY, JSON.stringify(DEFAULT_TOKENS));
        return DEFAULT_TOKENS;
      }
      return JSON.parse(data);
    } catch {
      return DEFAULT_TOKENS;
    }
  },
  saveTokens: (tokens: Token[]): boolean => {
    try {
      localStorage.setItem(TOKENS_STORAGE_KEY, JSON.stringify(tokens));
      return true;
    } catch {
      return false;
    }
  },
  addToken: (token: Token): boolean => {
    try {
      const tokens = tokenStorageAPI.getTokens();
      if (tokens.find(t => t.address.toLowerCase() === token.address.toLowerCase())) {
        return false; // Already exists
      }
      tokens.push(token);
      return tokenStorageAPI.saveTokens(tokens);
    } catch {
      return false;
    }
  },
  removeToken: (address: string): boolean => {
    try {
      const tokens = tokenStorageAPI.getTokens().filter(
        t => t.address.toLowerCase() !== address.toLowerCase()
      );
      return tokenStorageAPI.saveTokens(tokens);
    } catch {
      return false;
    }
  }
};

// NFT localStorage API
const nftStorageAPI = {
  getNFTs: (): NFT[] => {
    try {
      const data = localStorage.getItem(NFTS_STORAGE_KEY);
      if (!data) return [];
      return JSON.parse(data);
    } catch {
      return [];
    }
  },
  saveNFTs: (nfts: NFT[]): boolean => {
    try {
      localStorage.setItem(NFTS_STORAGE_KEY, JSON.stringify(nfts));
      return true;
    } catch {
      return false;
    }
  }
};

// Address Book localStorage API
const addressBookAPI = {
  getEntries: (): AddressBookEntry[] => {
    try {
      const data = localStorage.getItem(ADDRESSBOOK_STORAGE_KEY);
      if (!data) return [];
      return JSON.parse(data);
    } catch {
      return [];
    }
  },
  saveEntries: (entries: AddressBookEntry[]): boolean => {
    try {
      localStorage.setItem(ADDRESSBOOK_STORAGE_KEY, JSON.stringify(entries));
      return true;
    } catch {
      return false;
    }
  },
  addEntry: (entry: AddressBookEntry): boolean => {
    try {
      const entries = addressBookAPI.getEntries();
      if (entries.find(e => e.address.toLowerCase() === entry.address.toLowerCase())) {
        return false; // Already exists
      }
      entries.push(entry);
      return addressBookAPI.saveEntries(entries);
    } catch {
      return false;
    }
  },
  updateEntry: (address: string, updates: Partial<AddressBookEntry>): boolean => {
    try {
      const entries = addressBookAPI.getEntries();
      const index = entries.findIndex(e => e.address.toLowerCase() === address.toLowerCase());
      if (index === -1) return false;
      entries[index] = { ...entries[index], ...updates };
      return addressBookAPI.saveEntries(entries);
    } catch {
      return false;
    }
  },
  removeEntry: (address: string): boolean => {
    try {
      const entries = addressBookAPI.getEntries().filter(
        e => e.address.toLowerCase() !== address.toLowerCase()
      );
      return addressBookAPI.saveEntries(entries);
    } catch {
      return false;
    }
  }
};

// NFT Collections localStorage API
const nftCollectionsAPI = {
  getCollections: (): NFTCollection[] => {
    try {
      const data = localStorage.getItem(NFT_COLLECTIONS_STORAGE_KEY);
      if (!data) return [];
      return JSON.parse(data);
    } catch {
      return [];
    }
  },
  saveCollections: (collections: NFTCollection[]): boolean => {
    try {
      localStorage.setItem(NFT_COLLECTIONS_STORAGE_KEY, JSON.stringify(collections));
      return true;
    } catch {
      return false;
    }
  },
  addCollection: (collection: NFTCollection): boolean => {
    try {
      const collections = nftCollectionsAPI.getCollections();
      if (collections.find(c => c.address.toLowerCase() === collection.address.toLowerCase())) {
        return false; // Already exists
      }
      collections.push(collection);
      return nftCollectionsAPI.saveCollections(collections);
    } catch {
      return false;
    }
  },
  removeCollection: (address: string): boolean => {
    try {
      const collections = nftCollectionsAPI.getCollections().filter(
        c => c.address.toLowerCase() !== address.toLowerCase()
      );
      return nftCollectionsAPI.saveCollections(collections);
    } catch {
      return false;
    }
  }
};

function App() {
  // State
  const [activeTab, setActiveTab] = useState<'dashboard' | 'send' | 'receive' | 'stake' | 'tokens' | 'mine' | 'addressbook'>('dashboard');
  const [wallets, setWallets] = useState<WalletData[]>([]);
  const [currentWallet, setCurrentWallet] = useState<WalletData | null>(null);
  const [balance, setBalance] = useState<string>('0.0000');
  const [blockNumber, setBlockNumber] = useState<number>(0);
  const [peerCount, setPeerCount] = useState<number>(0);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<number>(0);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [showModal, setShowModal] = useState<string | null>(null);
  const [toast, setToast] = useState<{message: string; type: 'success' | 'error'} | null>(null);
  const [password, setPassword] = useState('');
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [privateKey, setPrivateKey] = useState('');
  const [newWalletData, setNewWalletData] = useState<{address: string; privateKey: string} | null>(null);

  // Mining state
  const [isMining, setIsMining] = useState(false);
  const [hashrate, setHashrate] = useState<string>('0');
  const [coinbase, setCoinbase] = useState<string>('');
  const [miningThreads, setMiningThreads] = useState<number>(1);
  const [miningMode, setMiningMode] = useState<'cpu' | 'gpu'>('cpu');
  const [gpuType, setGpuType] = useState<'nvidia' | 'amd' | 'both'>('nvidia');
  const [stratumPort, setStratumPort] = useState<number>(3333);

  // Node stats
  const [gasPrice, setGasPrice] = useState<string>('0');
  const [nodeVersion, setNodeVersion] = useState<string>('');
  const [networkId, setNetworkId] = useState<number>(0);
  const [pendingTxCount, setPendingTxCount] = useState<number>(0);

  // NFT state
  const [nfts, setNfts] = useState<NFT[]>([]);
  const [loadingNFTs, setLoadingNFTs] = useState(false);
  const [tokenSubTab, setTokenSubTab] = useState<'tokens' | 'nfts'>('tokens');
  const [selectedNFT, setSelectedNFT] = useState<NFT | null>(null);
  const [nftMetadata, setNftMetadata] = useState<NFTMetadata | null>(null);
  const [loadingNFTMetadata, setLoadingNFTMetadata] = useState(false);
  const [nftSendTo, setNftSendTo] = useState('');
  const [nftSendAmount, setNftSendAmount] = useState('1');
  const [sendingNFT, setSendingNFT] = useState(false);
  const [customCollections, setCustomCollections] = useState<NFTCollection[]>([]);
  const [newCollectionAddress, setNewCollectionAddress] = useState('');
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionMaxId, setNewCollectionMaxId] = useState('10');
  const [newCollectionType, setNewCollectionType] = useState<'ERC1155' | 'ERC721'>('ERC1155');

  // Address Book state
  const [addressBook, setAddressBook] = useState<AddressBookEntry[]>([]);
  const [newContactName, setNewContactName] = useState('');
  const [newContactAddress, setNewContactAddress] = useState('');
  const [newContactLabel, setNewContactLabel] = useState('');
  const [newContactNotes, setNewContactNotes] = useState('');
  const [editingContact, setEditingContact] = useState<AddressBookEntry | null>(null);
  const [addressBookSearch, setAddressBookSearch] = useState('');

  // Theme state
  const [theme, setTheme] = useState<'matrix' | 'dark' | 'light'>(() => {
    const saved = localStorage.getItem('altcoinchain-theme');
    return (saved as 'matrix' | 'dark' | 'light') || 'matrix';
  });

  // Menu and Console state
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [showConsole, setShowConsole] = useState(false);
  const [consoleInput, setConsoleInput] = useState('');
  const [consoleHistory, setConsoleHistory] = useState<{type: 'input' | 'output' | 'error'; text: string}[]>([
    { type: 'output', text: 'Welcome to Altcoinchain Console' },
    { type: 'output', text: 'Type "help" for available commands' },
  ]);
  const [showNetworkInfo, setShowNetworkInfo] = useState(false);
  const [showPeers, setShowPeers] = useState(false);
  const [peers, setPeers] = useState<any[]>([]);
  const [exportedPrivateKey, setExportedPrivateKey] = useState<string>('');

  // Form states
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [stakeAmount, setStakeAmount] = useState('');
  const [newWalletName, setNewWalletName] = useState('');
  const [newWalletPassword, setNewWalletPassword] = useState('');
  const [newWalletPassword2, setNewWalletPassword2] = useState('');
  const [importPrivateKey, setImportPrivateKey] = useState('');

  // Token form states
  const [newTokenAddress, setNewTokenAddress] = useState('');
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenSymbol, setNewTokenSymbol] = useState('');
  const [newTokenDecimals, setNewTokenDecimals] = useState('18');
  const [loadingTokenInfo, setLoadingTokenInfo] = useState(false);

  // Token send/receive states
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [tokenSendTo, setTokenSendTo] = useState('');
  const [tokenSendAmount, setTokenSendAmount] = useState('');
  const [sendingToken, setSendingToken] = useState(false);

  // RPC Call helper
  const rpcCall = useCallback(async (method: string, params: any[] = []) => {
    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
      });
      const data = await res.json();
      return data.error ? null : data.result;
    } catch (e) {
      return null;
    }
  }, []);

  // RPC Call that returns full response (for methods that return null on success)
  const rpcCallRaw = useCallback(async (method: string, params: any[] = []): Promise<{success: boolean; result: any; error?: string}> => {
    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
      });
      const data = await res.json();
      if (data.error) {
        return { success: false, result: null, error: data.error.message };
      }
      return { success: true, result: data.result };
    } catch (e: any) {
      return { success: false, result: null, error: e.message };
    }
  }, []);

  // Show toast notification
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Load wallets
  const loadWallets = useCallback(async () => {
    let w: WalletData[] = [];
    if (window.electronAPI) {
      w = await window.electronAPI.getWallets();
    } else {
      // Fallback to localStorage for browser mode
      w = localStorageAPI.getWallets();
    }
    setWallets(w);
    if (w.length > 0 && !currentWallet) {
      setCurrentWallet(w[0]);
    }
  }, [currentWallet]);

  // Update network info
  const updateNetworkInfo = useCallback(async () => {
    const block = await rpcCall('eth_blockNumber');
    if (block) setBlockNumber(parseInt(block, 16));

    const peers = await rpcCall('net_peerCount');
    if (peers) setPeerCount(parseInt(peers, 16));

    const syncStatus = await rpcCall('eth_syncing');
    if (syncStatus === false) {
      setSyncing(false);
      setSyncProgress(100);
    } else if (syncStatus) {
      setSyncing(true);
      const current = parseInt(syncStatus.currentBlock, 16);
      const highest = parseInt(syncStatus.highestBlock, 16);
      setSyncProgress((current / highest) * 100);
    }

    // Check mining status
    const mining = await rpcCall('eth_mining');
    setIsMining(mining === true);

    const hr = await rpcCall('eth_hashrate');
    if (hr) {
      const hrNum = parseInt(hr, 16);
      if (hrNum > 1000000000) {
        setHashrate((hrNum / 1000000000).toFixed(2) + ' GH/s');
      } else if (hrNum > 1000000) {
        setHashrate((hrNum / 1000000).toFixed(2) + ' MH/s');
      } else if (hrNum > 1000) {
        setHashrate((hrNum / 1000).toFixed(2) + ' KH/s');
      } else {
        setHashrate(hrNum + ' H/s');
      }
    }

    const cb = await rpcCall('eth_coinbase');
    if (cb) setCoinbase(cb);

    // Additional node stats
    const gp = await rpcCall('eth_gasPrice');
    if (gp) {
      const gpGwei = parseInt(gp, 16) / 1e9;
      setGasPrice(gpGwei.toFixed(2));
    }

    const netId = await rpcCall('net_version');
    if (netId) setNetworkId(parseInt(netId));

    const pending = await rpcCall('eth_getBlockTransactionCountByNumber', ['pending']);
    if (pending) setPendingTxCount(parseInt(pending, 16));

    const nodeInfo = await rpcCall('web3_clientVersion');
    if (nodeInfo) setNodeVersion(nodeInfo);
  }, [rpcCall]);

  // Start mining
  const startMining = async () => {
    if (!currentWallet?.address) {
      showToast('Please select a wallet first', 'error');
      return;
    }

    // Set coinbase to current wallet
    const setResult = await rpcCallRaw('miner_setEtherbase', [currentWallet.address]);
    if (!setResult.success) {
      showToast('Failed to set mining address: ' + (setResult.error || 'Unknown error'), 'error');
      return;
    }

    // Start miner with specified threads
    const startResult = await rpcCallRaw('miner_start', [miningThreads]);
    if (!startResult.success) {
      showToast('Failed to start mining: ' + (startResult.error || 'Make sure node has miner API enabled'), 'error');
      return;
    }

    showToast(`Mining started with ${miningThreads} thread(s)!`);
    setIsMining(true);
  };

  // Stop mining
  const stopMining = async () => {
    const result = await rpcCallRaw('miner_stop');
    if (!result.success) {
      showToast('Failed to stop mining: ' + (result.error || 'Unknown error'), 'error');
      return;
    }
    showToast('Mining stopped');
    setIsMining(false);
  };

  // Set coinbase address
  const setCoinbaseAddress = async (address: string) => {
    if (!ethers.isAddress(address)) {
      showToast('Invalid address', 'error');
      return;
    }
    const result = await rpcCall('miner_setEtherbase', [address]);
    if (result) {
      showToast('Mining address updated');
      setCoinbase(address);
    } else {
      showToast('Failed to set mining address', 'error');
    }
  };

  // Update balance
  const updateBalance = useCallback(async () => {
    if (!currentWallet?.address) return;
    const bal = await rpcCall('eth_getBalance', [currentWallet.address, 'latest']);
    if (bal) {
      setBalance(parseFloat(ethers.formatEther(bal)).toFixed(4));
    }
  }, [currentWallet, rpcCall]);

  // Load tokens from storage, auto-scan known tokens, and update balances
  const loadTokens = useCallback(async () => {
    let storedTokens = tokenStorageAPI.getTokens();

    if (currentWallet?.address) {
      const provider = new ethers.JsonRpcProvider(RPC_URL);

      // Auto-scan known tokens and add any with balance
      for (const knownToken of KNOWN_TOKENS) {
        const alreadyAdded = storedTokens.find(
          t => t.address.toLowerCase() === knownToken.address.toLowerCase()
        );
        if (!alreadyAdded) {
          try {
            const contract = new ethers.Contract(knownToken.address, ERC20_ABI, provider);
            const balance = await contract.balanceOf(currentWallet.address);
            if (BigInt(balance.toString()) > BigInt(0)) {
              // Auto-add token with balance
              tokenStorageAPI.addToken(knownToken);
              storedTokens = tokenStorageAPI.getTokens();
            }
          } catch {
            // Token contract doesn't exist or error
          }
        }
      }

      // Update all token balances
      const updatedTokens = await Promise.all(
        storedTokens.map(async (token) => {
          try {
            const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
            const balance = await contract.balanceOf(currentWallet.address);
            const formattedBalance = ethers.formatUnits(balance, token.decimals);
            console.log(`Token ${token.symbol} balance:`, formattedBalance);
            return {
              ...token,
              balance: formattedBalance
            };
          } catch (e: any) {
            console.error(`Error fetching balance for ${token.symbol}:`, e.message);
            return { ...token, balance: 'Error' };
          }
        })
      );
      setTokens(updatedTokens);
    } else {
      setTokens(storedTokens);
    }
  }, [currentWallet]);

  // Manually refresh single token balance with feedback
  const refreshTokenBalance = async (token: Token) => {
    if (!currentWallet?.address) {
      showToast('No wallet selected', 'error');
      return;
    }

    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const contract = new ethers.Contract(token.address, ERC20_ABI, provider);

      // Try to get balance
      const balance = await contract.balanceOf(currentWallet.address);
      const formattedBalance = ethers.formatUnits(balance, token.decimals);

      // Update the token in state
      setTokens(prev => prev.map(t =>
        t.address.toLowerCase() === token.address.toLowerCase()
          ? { ...t, balance: formattedBalance }
          : t
      ));

      showToast(`${token.symbol}: ${formattedBalance}`);
    } catch (e: any) {
      console.error('Token balance error:', e);
      showToast(`Failed to fetch ${token.symbol} balance: ${e.message}`, 'error');
    }
  };

  // Load NFTs for the current wallet - auto-scan all known and custom collections
  // Also checks staking contract for staked NFTs
  const loadNFTs = useCallback(async () => {
    if (!currentWallet?.address) return;

    setLoadingNFTs(true);
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const loadedNFTs: NFT[] = [];

    // Combine known collections with custom collections
    const customCols = nftCollectionsAPI.getCollections();
    const allCollections = [...KNOWN_NFT_COLLECTIONS, ...customCols];

    // Scan all NFT collections
    for (const collection of allCollections) {
      try {
        const isERC1155 = collection.type === 'ERC1155' || !collection.type;
        const nftContract = new ethers.Contract(
          collection.address,
          isERC1155 ? ERC1155_ABI : ERC721_ABI,
          provider
        );

        // Check each token ID in the collection
        for (let tokenId = 1; tokenId <= collection.maxTokenId; tokenId++) {
          try {
            let walletBalance = 0n;
            let stakedBalance = 0n;

            if (isERC1155) {
              // ERC1155: balanceOf(address, tokenId)
              walletBalance = await nftContract.balanceOf(currentWallet.address, tokenId);

              // Check staking contract for Mining Game only
              if (collection.address.toLowerCase() === DEFAULT_NFT_CONTRACT.toLowerCase()) {
                try {
                  const stakingBalance = await nftContract.balanceOf(NFT_STAKING_CONTRACT, tokenId);
                  if (stakingBalance > 0n) {
                    stakedBalance = stakingBalance;
                  }
                } catch {
                  // Staking check failed
                }
              }
            } else {
              // ERC721: Check ownerOf
              try {
                const owner = await nftContract.ownerOf(tokenId);
                if (owner.toLowerCase() === currentWallet.address.toLowerCase()) {
                  walletBalance = 1n;
                }
              } catch {
                // Token doesn't exist or error
              }
            }

            if (walletBalance > 0n || stakedBalance > 0n) {
              // Use Mining Game metadata if applicable
              const isMiningGame = collection.address.toLowerCase() === DEFAULT_NFT_CONTRACT.toLowerCase();
              const nftName = isMiningGame
                ? (MINING_GAME_NFT_NAMES[tokenId] || `Item #${tokenId}`)
                : `${collection.name} #${tokenId}`;
              const metadata = isMiningGame ? MINING_GAME_METADATA[tokenId] : undefined;
              const walletBal = Number(walletBalance);
              const stakedBal = Number(stakedBalance);

              loadedNFTs.push({
                address: collection.address,
                tokenId: tokenId.toString(),
                name: nftName,
                description: metadata?.description || `${collection.name} NFT`,
                image: metadata?.image || '',
                collection: collection.name,
                balance: walletBal,
                stakedBalance: stakedBal
              });
            }
          } catch (err) {
            console.log(`NFT #${tokenId} check failed:`, err);
          }
        }
      } catch (err) {
        console.log('Collection contract error:', err);
      }
    }

    setNfts(loadedNFTs);
    nftStorageAPI.saveNFTs(loadedNFTs);
    setLoadingNFTs(false);
  }, [currentWallet]);

  // Fetch NFT metadata - uses embedded data for Mining Game NFTs
  const fetchNFTMetadata = async (nft: NFT) => {
    setSelectedNFT(nft);
    setNftMetadata(null);
    setLoadingNFTMetadata(true);
    setShowModal('nftDetail');

    const tokenId = parseInt(nft.tokenId);

    // Check if this is a Mining Game NFT with embedded metadata
    if (nft.address.toLowerCase() === DEFAULT_NFT_CONTRACT.toLowerCase() && MINING_GAME_METADATA[tokenId]) {
      setNftMetadata(MINING_GAME_METADATA[tokenId]);
      setLoadingNFTMetadata(false);
      return;
    }

    // For other NFTs, try to fetch from contract URI
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);

      // Try ERC1155 uri() first, then ERC721 tokenURI()
      let tokenUri = '';
      try {
        const contract1155 = new ethers.Contract(nft.address, ERC1155_ABI, provider);
        tokenUri = await contract1155.uri(nft.tokenId);
      } catch {
        try {
          const contract721 = new ethers.Contract(nft.address, ERC721_ABI, provider);
          tokenUri = await contract721.tokenURI(nft.tokenId);
        } catch {
          console.log('Could not fetch token URI');
        }
      }

      if (tokenUri) {
        // Replace {id} placeholder with actual token ID (ERC1155 standard)
        tokenUri = tokenUri.replace('{id}', nft.tokenId.toString().padStart(64, '0'));

        // Handle IPFS URIs
        if (tokenUri.startsWith('ipfs://')) {
          tokenUri = tokenUri.replace('ipfs://', 'https://ipfs.io/ipfs/');
        }

        // Fetch metadata
        try {
          const response = await fetch(tokenUri);
          const metadata: NFTMetadata = await response.json();

          // Handle IPFS image URIs
          if (metadata.image?.startsWith('ipfs://')) {
            metadata.image = metadata.image.replace('ipfs://', 'https://ipfs.io/ipfs/');
          }

          setNftMetadata(metadata);
        } catch (e) {
          console.error('Failed to fetch metadata:', e);
          // Create basic metadata from what we have
          setNftMetadata({
            name: nft.name,
            description: nft.description,
            image: nft.image
          });
        }
      } else {
        // No URI, use basic info
        setNftMetadata({
          name: nft.name,
          description: nft.description,
          image: nft.image
        });
      }
    } catch (e) {
      console.error('Error fetching NFT metadata:', e);
      setNftMetadata({
        name: nft.name,
        description: nft.description,
        image: nft.image
      });
    }

    setLoadingNFTMetadata(false);
  };

  // Send NFT to another address
  const sendNFT = async () => {
    if (!selectedNFT || !currentWallet || !nftSendTo) {
      showToast('Please fill all fields', 'error');
      return;
    }

    if (!ethers.isAddress(nftSendTo)) {
      showToast('Invalid recipient address', 'error');
      return;
    }

    const amount = parseInt(nftSendAmount) || 1;
    if (amount < 1 || amount > (selectedNFT.balance || 0)) {
      showToast(`Invalid amount. You have ${selectedNFT.balance} available.`, 'error');
      return;
    }

    setShowModal('unlockNFTSend');
  };

  // Execute NFT send after unlock
  const executeNFTSend = async () => {
    if (!selectedNFT || !currentWallet || !nftSendTo || !password) {
      showToast('Missing required fields', 'error');
      return;
    }

    setSendingNFT(true);
    try {
      let walletFile;
      if (window.electronAPI) {
        walletFile = await window.electronAPI.loadWallet(currentWallet.filename);
      } else {
        walletFile = localStorageAPI.loadWallet(currentWallet.filename);
      }

      if (!walletFile.success) {
        showToast('Failed to load wallet', 'error');
        setSendingNFT(false);
        return;
      }

      const wallet = await ethers.Wallet.fromEncryptedJson(JSON.stringify(walletFile.content), password);
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const signer = wallet.connect(provider);

      const amount = parseInt(nftSendAmount) || 1;
      const nftContract = new ethers.Contract(selectedNFT.address, ERC1155_ABI, signer);

      // ERC1155 safeTransferFrom(from, to, id, amount, data)
      const tx = await nftContract.safeTransferFrom(
        currentWallet.address,
        nftSendTo,
        selectedNFT.tokenId,
        amount,
        '0x'
      );

      showToast(`NFT sent! TX: ${tx.hash.slice(0, 18)}...`);

      setShowModal(null);
      setNftSendTo('');
      setNftSendAmount('1');
      setPassword('');
      setSelectedNFT(null);

      // Refresh NFTs after delay
      setTimeout(loadNFTs, 3000);
    } catch (e: any) {
      showToast('Transfer failed: ' + e.message, 'error');
    }
    setSendingNFT(false);
  };

  // Fetch token info from contract
  const fetchTokenInfo = async (address: string) => {
    if (!ethers.isAddress(address)) {
      showToast('Invalid contract address', 'error');
      return;
    }

    setLoadingTokenInfo(true);
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const contract = new ethers.Contract(address, ERC20_ABI, provider);

      const [name, symbol, decimals] = await Promise.all([
        contract.name(),
        contract.symbol(),
        contract.decimals()
      ]);

      setNewTokenName(name);
      setNewTokenSymbol(symbol);
      setNewTokenDecimals(decimals.toString());
      showToast('Token info loaded!');
    } catch (e) {
      showToast('Could not fetch token info. Enter manually.', 'error');
    }
    setLoadingTokenInfo(false);
  };

  // Add custom token
  const addToken = async () => {
    if (!ethers.isAddress(newTokenAddress)) {
      showToast('Invalid contract address', 'error');
      return;
    }
    if (!newTokenSymbol || !newTokenName) {
      showToast('Please enter token name and symbol', 'error');
      return;
    }

    const token: Token = {
      address: newTokenAddress,
      name: newTokenName,
      symbol: newTokenSymbol.toUpperCase(),
      decimals: parseInt(newTokenDecimals) || 18
    };

    if (tokenStorageAPI.addToken(token)) {
      showToast(`${token.symbol} added successfully!`);
      setShowModal(null);
      loadTokens();
      // Clear form
      setNewTokenAddress('');
      setNewTokenName('');
      setNewTokenSymbol('');
      setNewTokenDecimals('18');
    } else {
      showToast('Token already exists', 'error');
    }
  };

  // Remove token
  const removeToken = (address: string) => {
    if (tokenStorageAPI.removeToken(address)) {
      showToast('Token removed');
      loadTokens();
    }
  };

  // Load custom NFT collections
  const loadCustomCollections = useCallback(() => {
    const collections = nftCollectionsAPI.getCollections();
    setCustomCollections(collections);
  }, []);

  // Add custom NFT collection
  const addCollection = () => {
    if (!ethers.isAddress(newCollectionAddress)) {
      showToast('Invalid contract address', 'error');
      return;
    }
    if (!newCollectionName.trim()) {
      showToast('Please enter collection name', 'error');
      return;
    }

    const collection: NFTCollection = {
      address: newCollectionAddress,
      name: newCollectionName.trim(),
      maxTokenId: parseInt(newCollectionMaxId) || 10,
      type: newCollectionType
    };

    if (nftCollectionsAPI.addCollection(collection)) {
      showToast('Collection added! Scanning for NFTs...');
      setShowModal(null);
      loadCustomCollections();
      loadNFTs();
      // Clear form
      setNewCollectionAddress('');
      setNewCollectionName('');
      setNewCollectionMaxId('10');
      setNewCollectionType('ERC1155');
    } else {
      showToast('Collection already exists', 'error');
    }
  };

  // Remove custom NFT collection
  const removeCollection = (address: string) => {
    if (nftCollectionsAPI.removeCollection(address)) {
      showToast('Collection removed');
      loadCustomCollections();
      loadNFTs();
    }
  };

  // Load address book
  const loadAddressBook = useCallback(() => {
    const entries = addressBookAPI.getEntries();
    setAddressBook(entries);
  }, []);

  // Add contact to address book
  const addContact = () => {
    if (!ethers.isAddress(newContactAddress)) {
      showToast('Invalid address', 'error');
      return;
    }
    if (!newContactName.trim()) {
      showToast('Please enter a name', 'error');
      return;
    }

    const entry: AddressBookEntry = {
      address: newContactAddress,
      name: newContactName.trim(),
      label: newContactLabel.trim() || undefined,
      notes: newContactNotes.trim() || undefined,
      addedAt: Date.now()
    };

    if (addressBookAPI.addEntry(entry)) {
      showToast('Contact added!');
      setShowModal(null);
      loadAddressBook();
      // Clear form
      setNewContactName('');
      setNewContactAddress('');
      setNewContactLabel('');
      setNewContactNotes('');
    } else {
      showToast('Contact already exists', 'error');
    }
  };

  // Update contact
  const updateContact = () => {
    if (!editingContact) return;

    const updates: Partial<AddressBookEntry> = {
      name: newContactName.trim() || editingContact.name,
      label: newContactLabel.trim() || undefined,
      notes: newContactNotes.trim() || undefined
    };

    if (addressBookAPI.updateEntry(editingContact.address, updates)) {
      showToast('Contact updated!');
      setShowModal(null);
      setEditingContact(null);
      loadAddressBook();
      // Clear form
      setNewContactName('');
      setNewContactAddress('');
      setNewContactLabel('');
      setNewContactNotes('');
    } else {
      showToast('Failed to update contact', 'error');
    }
  };

  // Remove contact
  const removeContact = (address: string) => {
    if (addressBookAPI.removeEntry(address)) {
      showToast('Contact removed');
      loadAddressBook();
    }
  };

  // Use contact address in send form
  const selectContactForSend = (address: string) => {
    setSendTo(address);
    setActiveTab('send');
    showToast('Address copied to send form');
  };

  // Send token
  const sendToken = async () => {
    if (!selectedToken || !currentWallet || !tokenSendTo || !tokenSendAmount) {
      showToast('Please fill all fields', 'error');
      return;
    }

    if (!ethers.isAddress(tokenSendTo)) {
      showToast('Invalid recipient address', 'error');
      return;
    }

    setShowModal('unlockTokenSend');
  };

  // Execute token send after unlock
  const executeTokenSend = async () => {
    if (!selectedToken || !currentWallet) return;

    setSendingToken(true);
    try {
      let walletFile: { success: boolean; content: any };
      if (window.electronAPI) {
        walletFile = await window.electronAPI.loadWallet(currentWallet.filename);
      } else {
        walletFile = localStorageAPI.loadWallet(currentWallet.filename);
      }

      if (!walletFile.success) {
        showToast('Failed to load wallet', 'error');
        setSendingToken(false);
        return;
      }

      const wallet = await ethers.Wallet.fromEncryptedJson(JSON.stringify(walletFile.content), password);
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const signer = wallet.connect(provider);

      const tokenContract = new ethers.Contract(selectedToken.address, ERC20_ABI, signer);
      const amount = ethers.parseUnits(tokenSendAmount, selectedToken.decimals);

      const tx = await tokenContract.transfer(tokenSendTo, amount);
      showToast(`${selectedToken.symbol} sent! TX: ${tx.hash.slice(0, 18)}...`);

      setShowModal(null);
      setTokenSendTo('');
      setTokenSendAmount('');
      setPassword('');
      setSelectedToken(null);

      // Refresh balances after delay
      setTimeout(loadTokens, 3000);
    } catch (e: any) {
      showToast('Transaction failed: ' + e.message, 'error');
    }
    setSendingToken(false);
  };

  // Open token send modal
  const openTokenSend = (token: Token) => {
    setSelectedToken(token);
    setShowModal('sendToken');
  };

  // Open token receive modal
  const openTokenReceive = (token: Token) => {
    setSelectedToken(token);
    setShowModal('receiveToken');
  };

  // Create new wallet
  const createWallet = async () => {
    if (!newWalletPassword || newWalletPassword.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }
    if (newWalletPassword !== newWalletPassword2) {
      showToast('Passwords do not match', 'error');
      return;
    }

    try {
      const wallet = ethers.Wallet.createRandom();
      const keystore = await wallet.encrypt(newWalletPassword);
      const keystoreObj = JSON.parse(keystore);
      keystoreObj.name = newWalletName || 'My Wallet';

      const filename = `${(newWalletName || 'wallet').toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}.json`;

      if (window.electronAPI) {
        await window.electronAPI.saveWallet(filename, keystoreObj);
      } else {
        // Fallback to localStorage for browser mode
        localStorageAPI.saveWallet(filename, keystoreObj);
      }

      setNewWalletData({ address: wallet.address, privateKey: wallet.privateKey });
      setShowModal('newWalletCreated');
      loadWallets();

      // Clear form
      setNewWalletName('');
      setNewWalletPassword('');
      setNewWalletPassword2('');
    } catch (e: any) {
      showToast('Error creating wallet: ' + e.message, 'error');
    }
  };

  // Import wallet from private key
  const importWallet = async () => {
    let pk = importPrivateKey.trim();
    if (!pk.startsWith('0x')) pk = '0x' + pk;

    if (!newWalletPassword || newWalletPassword.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }

    try {
      const wallet = new ethers.Wallet(pk);
      const keystore = await wallet.encrypt(newWalletPassword);
      const keystoreObj = JSON.parse(keystore);
      keystoreObj.name = newWalletName || 'Imported Wallet';

      const filename = `${(newWalletName || 'imported').toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}.json`;

      if (window.electronAPI) {
        await window.electronAPI.saveWallet(filename, keystoreObj);
      } else {
        // Fallback to localStorage for browser mode
        localStorageAPI.saveWallet(filename, keystoreObj);
      }

      showToast('Wallet imported successfully!');
      setShowModal(null);
      loadWallets();

      // Clear form
      setImportPrivateKey('');
      setNewWalletName('');
      setNewWalletPassword('');
    } catch (e: any) {
      showToast('Invalid private key: ' + e.message, 'error');
    }
  };

  // Send transaction
  const sendTransaction = async () => {
    if (!currentWallet || !sendTo || !sendAmount) {
      showToast('Please fill all fields', 'error');
      return;
    }

    if (!ethers.isAddress(sendTo)) {
      showToast('Invalid recipient address', 'error');
      return;
    }

    setShowModal('unlockWallet');
  };

  // Execute send after unlock
  const executeSend = async () => {
    try {
      if (!currentWallet) return;

      let walletFile: { success: boolean; content: any };
      if (window.electronAPI) {
        walletFile = await window.electronAPI.loadWallet(currentWallet.filename);
      } else {
        // Fallback to localStorage for browser mode
        walletFile = localStorageAPI.loadWallet(currentWallet.filename);
      }

      if (!walletFile.success) {
        showToast('Failed to load wallet', 'error');
        return;
      }

      const wallet = await ethers.Wallet.fromEncryptedJson(JSON.stringify(walletFile.content), password);
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const signer = wallet.connect(provider);

      const tx = await signer.sendTransaction({
        to: sendTo,
        value: ethers.parseEther(sendAmount),
        gasLimit: 21000n
      });

      showToast('Transaction sent: ' + tx.hash.slice(0, 18) + '...');
      setShowModal(null);
      setSendTo('');
      setSendAmount('');
      setPassword('');

      // Refresh balance after a delay
      setTimeout(updateBalance, 3000);
    } catch (e: any) {
      showToast('Transaction failed: ' + e.message, 'error');
    }
  };

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard!');
  };

  // Export private key from wallet
  const executeExportKey = async () => {
    try {
      if (!currentWallet) {
        showToast('No wallet selected', 'error');
        return;
      }

      let walletFile: { success: boolean; content: any };
      if (window.electronAPI) {
        walletFile = await window.electronAPI.loadWallet(currentWallet.filename);
      } else {
        walletFile = localStorageAPI.loadWallet(currentWallet.filename);
      }

      if (!walletFile.success) {
        showToast('Failed to load wallet', 'error');
        return;
      }

      const wallet = await ethers.Wallet.fromEncryptedJson(JSON.stringify(walletFile.content), password);
      setExportedPrivateKey(wallet.privateKey);
      setPassword('');
      showToast('Private key exported successfully');
    } catch (e: any) {
      showToast('Failed to decrypt wallet: ' + e.message, 'error');
    }
  };

  // Execute console command via RPC
  const executeConsoleCommand = async (command: string) => {
    setConsoleHistory(prev => [...prev, { type: 'input', text: '> ' + command }]);

    const parts = command.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    // Built-in commands
    if (cmd === 'help') {
      const helpText = `Available commands:
  help                    - Show this help message
  clear                   - Clear console history
  getblockcount           - Get current block number
  getpeercount            - Get connected peer count
  getbalance [address]    - Get balance of address
  gasprice                - Get current gas price
  chainid                 - Get chain ID
  syncing                 - Get sync status
  eth_blockNumber         - Get block number (hex)
  eth_gasPrice            - Get gas price (hex)
  eth_chainId             - Get chain ID (hex)
  net_peerCount           - Get peer count (hex)
  net_version             - Get network version
  web3_clientVersion      - Get client version
  eth_getBalance <addr>   - Get balance (hex)
  eth_getTransactionCount <addr> - Get nonce`;
      setConsoleHistory(prev => [...prev, { type: 'output', text: helpText }]);
      return;
    }

    if (cmd === 'clear') {
      setConsoleHistory([{ type: 'output', text: 'Console cleared' }]);
      return;
    }

    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      let result: any;

      // User-friendly commands
      if (cmd === 'getblockcount') {
        result = await provider.getBlockNumber();
      } else if (cmd === 'getpeercount') {
        result = await provider.send('net_peerCount', []);
        result = parseInt(result, 16);
      } else if (cmd === 'getbalance') {
        const addr = args[0] || currentWallet?.address;
        if (!addr) {
          setConsoleHistory(prev => [...prev, { type: 'error', text: 'Error: No address specified' }]);
          return;
        }
        const bal = await provider.getBalance(addr);
        result = ethers.formatEther(bal) + ' ALT';
      } else if (cmd === 'gasprice') {
        const fee = await provider.getFeeData();
        result = ethers.formatUnits(fee.gasPrice || 0, 'gwei') + ' Gwei';
      } else if (cmd === 'chainid') {
        const network = await provider.getNetwork();
        result = network.chainId.toString();
      } else if (cmd === 'syncing') {
        result = await provider.send('eth_syncing', []);
        result = result === false ? 'Not syncing (fully synced)' : JSON.stringify(result, null, 2);
      }
      // Direct RPC methods
      else if (cmd.startsWith('eth_') || cmd.startsWith('net_') || cmd.startsWith('web3_') || cmd.startsWith('admin_') || cmd.startsWith('personal_') || cmd.startsWith('debug_') || cmd.startsWith('txpool_')) {
        const params = args.map(arg => {
          // Try to parse JSON, otherwise use as string
          try {
            return JSON.parse(arg);
          } catch {
            return arg;
          }
        });
        result = await provider.send(cmd, params);
        if (typeof result === 'object') {
          result = JSON.stringify(result, null, 2);
        }
      } else {
        setConsoleHistory(prev => [...prev, { type: 'error', text: `Unknown command: ${cmd}. Type "help" for available commands.` }]);
        return;
      }

      setConsoleHistory(prev => [...prev, { type: 'output', text: String(result) }]);
    } catch (e: any) {
      setConsoleHistory(prev => [...prev, { type: 'error', text: 'Error: ' + e.message }]);
    }
  };

  // Fetch peers list
  const fetchPeers = async () => {
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const peersData = await provider.send('admin_peers', []);
      setPeers(peersData || []);
    } catch (e) {
      setPeers([]);
    }
  };

  // Theme effect
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('altcoinchain-theme', theme);
  }, [theme]);

  // Effects
  useEffect(() => {
    loadWallets();
    updateNetworkInfo();
    loadTokens();
    loadAddressBook();
    loadCustomCollections();
    const interval = setInterval(() => {
      updateNetworkInfo();
      updateBalance();
      loadTokens();
    }, 10000);
    return () => clearInterval(interval);
  }, [loadWallets, updateNetworkInfo, updateBalance, loadTokens, loadAddressBook, loadCustomCollections]);

  useEffect(() => {
    if (currentWallet) {
      updateBalance();
      loadTokens();
      loadNFTs();
    }
  }, [currentWallet, updateBalance, loadTokens, loadNFTs]);

  return (
    <div className="min-h-screen bg-background cyber-grid relative overflow-hidden">
      {/* Background Effects - Only show for Matrix theme */}
      {theme === 'matrix' && (
        <>
          <MatrixRain />
          <Scanlines />
          <GlitchOverlay />
        </>
      )}

      {/* Window Controls */}
      <div className="window-controls fixed top-0 left-0 right-0 h-10 bg-background/90 backdrop-blur-sm z-50 flex items-center justify-between px-4 border-b border-primary/20">
        <div className="flex items-center gap-3">
          <img src="/icon.png" alt="ALT" className="w-6 h-6" onError={(e) => e.currentTarget.style.display = 'none'} />
          <span className="text-primary font-cyber text-sm tracking-wider">ALTCOINCHAIN WALLET</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Theme Selector */}
          <div className="flex items-center gap-1 mr-2 bg-surface/50 rounded-lg p-1">
            <button
              onClick={() => setTheme('matrix')}
              className={`w-7 h-7 flex items-center justify-center rounded transition-all ${
                theme === 'matrix' ? 'bg-primary/30 text-primary' : 'text-text/50 hover:text-primary hover:bg-primary/10'
              }`}
              title="Matrix Theme"
            >
              <Monitor size={14} />
            </button>
            <button
              onClick={() => setTheme('dark')}
              className={`w-7 h-7 flex items-center justify-center rounded transition-all ${
                theme === 'dark' ? 'bg-primary/30 text-primary' : 'text-text/50 hover:text-primary hover:bg-primary/10'
              }`}
              title="Dark Theme"
            >
              <Moon size={14} />
            </button>
            <button
              onClick={() => setTheme('light')}
              className={`w-7 h-7 flex items-center justify-center rounded transition-all ${
                theme === 'light' ? 'bg-primary/30 text-primary' : 'text-text/50 hover:text-primary hover:bg-primary/10'
              }`}
              title="Light Theme"
            >
              <Sun size={14} />
            </button>
          </div>
          {/* Window Buttons */}
          <button onClick={() => window.electronAPI?.minimize()} className="w-8 h-8 flex items-center justify-center hover:bg-primary/20 rounded transition-colors">
            <div className="w-3 h-0.5 bg-text/70" />
          </button>
          <button onClick={() => window.electronAPI?.maximize()} className="w-8 h-8 flex items-center justify-center hover:bg-primary/20 rounded transition-colors">
            <div className="w-3 h-3 border border-text/70" />
          </button>
          <button onClick={() => window.electronAPI?.close()} className="w-8 h-8 flex items-center justify-center hover:bg-red-500/50 rounded transition-colors">
            <X size={14} className="text-text/70" />
          </button>
        </div>
      </div>

      {/* Menu Bar */}
      <div className="fixed top-10 left-0 right-0 h-8 bg-surface/80 backdrop-blur-sm z-40 flex items-center px-2 border-b border-primary/10 text-sm">
        {/* File Menu */}
        <div className="relative">
          <button
            onClick={() => setActiveMenu(activeMenu === 'file' ? null : 'file')}
            className={`px-3 py-1 hover:bg-primary/20 rounded ${activeMenu === 'file' ? 'bg-primary/20' : ''}`}
          >
            File
          </button>
          {activeMenu === 'file' && (
            <div className="absolute top-full left-0 mt-1 bg-surface border border-primary/30 rounded shadow-lg min-w-[200px] py-1 z-50">
              <button onClick={() => { setShowModal('createWallet'); setActiveMenu(null); }} className="w-full px-4 py-2 text-left hover:bg-primary/20 flex items-center gap-2">
                <Plus size={14} /> Create New Wallet
              </button>
              <button onClick={() => { setShowModal('importWallet'); setActiveMenu(null); }} className="w-full px-4 py-2 text-left hover:bg-primary/20 flex items-center gap-2">
                <Upload size={14} /> Import Wallet
              </button>
              <button onClick={() => { setShowModal('importPrivateKey'); setActiveMenu(null); }} className="w-full px-4 py-2 text-left hover:bg-primary/20 flex items-center gap-2">
                <Key size={14} /> Import Private Key
              </button>
              <div className="border-t border-primary/20 my-1" />
              <button onClick={() => { window.electronAPI?.openDataDir(); setActiveMenu(null); }} className="w-full px-4 py-2 text-left hover:bg-primary/20 flex items-center gap-2">
                <FolderOpen size={14} /> Open Data Directory
              </button>
              <div className="border-t border-primary/20 my-1" />
              <button onClick={() => { window.electronAPI?.close(); }} className="w-full px-4 py-2 text-left hover:bg-primary/20 flex items-center gap-2">
                <X size={14} /> Exit
              </button>
            </div>
          )}
        </div>

        {/* Settings Menu */}
        <div className="relative">
          <button
            onClick={() => setActiveMenu(activeMenu === 'settings' ? null : 'settings')}
            className={`px-3 py-1 hover:bg-primary/20 rounded ${activeMenu === 'settings' ? 'bg-primary/20' : ''}`}
          >
            Settings
          </button>
          {activeMenu === 'settings' && (
            <div className="absolute top-full left-0 mt-1 bg-surface border border-primary/30 rounded shadow-lg min-w-[200px] py-1 z-50">
              <button onClick={() => { setShowModal('unlockExportKey'); setActiveMenu(null); }} className="w-full px-4 py-2 text-left hover:bg-primary/20 flex items-center gap-2">
                <Key size={14} /> Export Private Key
              </button>
              <div className="border-t border-primary/20 my-1" />
              <div className="px-4 py-2 text-text/50 text-xs uppercase">Theme</div>
              <button onClick={() => { setTheme('matrix'); setActiveMenu(null); }} className={`w-full px-4 py-2 text-left hover:bg-primary/20 flex items-center gap-2 ${theme === 'matrix' ? 'text-primary' : ''}`}>
                <Monitor size={14} /> Matrix {theme === 'matrix' && <Check size={12} className="ml-auto" />}
              </button>
              <button onClick={() => { setTheme('dark'); setActiveMenu(null); }} className={`w-full px-4 py-2 text-left hover:bg-primary/20 flex items-center gap-2 ${theme === 'dark' ? 'text-primary' : ''}`}>
                <Moon size={14} /> Dark {theme === 'dark' && <Check size={12} className="ml-auto" />}
              </button>
              <button onClick={() => { setTheme('light'); setActiveMenu(null); }} className={`w-full px-4 py-2 text-left hover:bg-primary/20 flex items-center gap-2 ${theme === 'light' ? 'text-primary' : ''}`}>
                <Sun size={14} /> Light {theme === 'light' && <Check size={12} className="ml-auto" />}
              </button>
            </div>
          )}
        </div>

        {/* Window Menu */}
        <div className="relative">
          <button
            onClick={() => setActiveMenu(activeMenu === 'window' ? null : 'window')}
            className={`px-3 py-1 hover:bg-primary/20 rounded ${activeMenu === 'window' ? 'bg-primary/20' : ''}`}
          >
            Window
          </button>
          {activeMenu === 'window' && (
            <div className="absolute top-full left-0 mt-1 bg-surface border border-primary/30 rounded shadow-lg min-w-[200px] py-1 z-50">
              <button onClick={() => { setShowConsole(true); setActiveMenu(null); }} className="w-full px-4 py-2 text-left hover:bg-primary/20 flex items-center gap-2">
                <Terminal size={14} /> Console
              </button>
              <button onClick={() => { setShowNetworkInfo(true); setActiveMenu(null); }} className="w-full px-4 py-2 text-left hover:bg-primary/20 flex items-center gap-2">
                <Globe size={14} /> Network
              </button>
              <button onClick={() => { fetchPeers(); setShowPeers(true); setActiveMenu(null); }} className="w-full px-4 py-2 text-left hover:bg-primary/20 flex items-center gap-2">
                <Users size={14} /> Peers
              </button>
            </div>
          )}
        </div>

        {/* Help Menu */}
        <div className="relative">
          <button
            onClick={() => setActiveMenu(activeMenu === 'help' ? null : 'help')}
            className={`px-3 py-1 hover:bg-primary/20 rounded ${activeMenu === 'help' ? 'bg-primary/20' : ''}`}
          >
            Help
          </button>
          {activeMenu === 'help' && (
            <div className="absolute top-full left-0 mt-1 bg-surface border border-primary/30 rounded shadow-lg min-w-[200px] py-1 z-50">
              <button onClick={() => { setShowModal('about'); setActiveMenu(null); }} className="w-full px-4 py-2 text-left hover:bg-primary/20 flex items-center gap-2">
                <Info size={14} /> About Altcoinchain
              </button>
              <button onClick={() => { window.open('https://altcoinchain.org', '_blank'); setActiveMenu(null); }} className="w-full px-4 py-2 text-left hover:bg-primary/20 flex items-center gap-2">
                <ExternalLink size={14} /> Website
              </button>
            </div>
          )}
        </div>

        {/* Click outside to close menu */}
        {activeMenu && (
          <div className="fixed inset-0 z-30" onClick={() => setActiveMenu(null)} />
        )}
      </div>

      {/* Main Content */}
      <div className="pt-[72px] flex min-h-screen">
        {/* Sidebar */}
        <div className="w-64 bg-surface/50 backdrop-blur-sm border-r border-primary/20 p-4 flex flex-col">
          {/* Wallet Selector */}
          <div className="mb-6">
            <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Active Wallet</label>
            <select
              className="cyber-input text-sm"
              value={currentWallet?.filename || ''}
              onChange={(e) => {
                const w = wallets.find(w => w.filename === e.target.value);
                if (w) setCurrentWallet(w);
              }}
            >
              {wallets.map(w => (
                <option key={w.filename} value={w.filename}>{w.name}</option>
              ))}
            </select>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-2">
            {[
              { id: 'dashboard', icon: Activity, label: 'Dashboard' },
              { id: 'send', icon: Send, label: 'Send' },
              { id: 'receive', icon: Download, label: 'Receive' },
              { id: 'mine', icon: Cpu, label: 'Mine' },
              { id: 'stake', icon: Zap, label: 'Stake' },
              { id: 'tokens', icon: Coins, label: 'Tokens' },
              { id: 'addressbook', icon: Users, label: 'Contacts' },
            ].map(item => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded transition-all ${
                  activeTab === item.id
                    ? 'bg-primary/20 text-primary border border-primary/50 neon-box'
                    : 'text-text/70 hover:bg-primary/10 hover:text-primary'
                }`}
              >
                <item.icon size={18} />
                <span className="font-body tracking-wide">{item.label}</span>
                {activeTab === item.id && <ChevronRight size={14} className="ml-auto" />}
              </button>
            ))}
          </nav>

          {/* Wallet Actions */}
          <div className="space-y-2 pt-4 border-t border-primary/20">
            <button onClick={() => setShowModal('createWallet')} className="cyber-btn w-full text-xs flex items-center justify-center gap-2">
              <Plus size={14} /> New Wallet
            </button>
            <button onClick={() => setShowModal('importWallet')} className="cyber-btn cyber-btn-secondary w-full text-xs flex items-center justify-center gap-2">
              <Download size={14} /> Import
            </button>
          </div>

          {/* Network Status */}
          <div className="mt-4 pt-4 border-t border-primary/20">
            <div className="flex items-center gap-2 text-xs text-text/50 mb-2">
              <Server size={12} />
              <span>Network Status</span>
            </div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-text/50">Block</span>
                <span className="text-primary font-mono">{blockNumber.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text/50">Peers</span>
                <span className="text-neon-green font-mono">{peerCount}</span>
              </div>
              {syncing && (
                <div className="mt-2">
                  <div className="h-1 bg-surface rounded overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{width: `${syncProgress}%`}} />
                  </div>
                  <span className="text-primary">{syncProgress.toFixed(1)}% synced</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Main Panel */}
        <div className="flex-1 p-6 overflow-auto">
          {/* Dashboard Tab */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              {/* Balance Card */}
              <div className="cyber-card p-6 corner-brackets">
                <div className="text-xs text-text/50 uppercase tracking-wider mb-2">Total Balance</div>
                <div className="balance-display">{balance} ALT</div>
                {currentWallet && (
                  <div className="mt-4 flex items-center gap-2">
                    <span className="text-xs text-text/50 font-mono">{currentWallet.address}</span>
                    <button onClick={() => copyToClipboard(currentWallet.address)} className="text-primary hover:text-primary/80">
                      <Copy size={14} />
                    </button>
                  </div>
                )}
              </div>

              {/* Quick Actions */}
              <div className="grid grid-cols-3 gap-4">
                <button onClick={() => setActiveTab('send')} className="cyber-card p-4 hover:border-primary/50 transition-colors group">
                  <Send size={24} className="text-primary mb-2 group-hover:animate-pulse" />
                  <div className="text-sm font-cyber">Send</div>
                </button>
                <button onClick={() => setActiveTab('receive')} className="cyber-card p-4 hover:border-neon-green/50 transition-colors group">
                  <Download size={24} className="text-neon-green mb-2 group-hover:animate-pulse" />
                  <div className="text-sm font-cyber">Receive</div>
                </button>
                <button onClick={() => setActiveTab('stake')} className="cyber-card p-4 hover:border-secondary/50 transition-colors group">
                  <Zap size={24} className="text-secondary mb-2 group-hover:animate-pulse" />
                  <div className="text-sm font-cyber">Stake</div>
                </button>
              </div>

              {/* Network Info */}
              <div className="cyber-card p-6">
                <h3 className="text-sm font-cyber text-primary mb-4 flex items-center gap-2">
                  <Globe size={16} /> Node Statistics
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  <div className="bg-surface/30 p-3 rounded">
                    <div className="text-text/50 text-xs">Chain ID</div>
                    <div className="font-mono text-primary text-lg">{CHAIN_ID}</div>
                  </div>
                  <div className="bg-surface/30 p-3 rounded">
                    <div className="text-text/50 text-xs">Network ID</div>
                    <div className="font-mono text-primary text-lg">{networkId}</div>
                  </div>
                  <div className="bg-surface/30 p-3 rounded">
                    <div className="text-text/50 text-xs">Block Height</div>
                    <div className="font-mono text-primary text-lg">{blockNumber.toLocaleString()}</div>
                  </div>
                  <div className="bg-surface/30 p-3 rounded">
                    <div className="text-text/50 text-xs">Connected Peers</div>
                    <div className="font-mono text-neon-green text-lg">{peerCount}</div>
                  </div>
                  <div className="bg-surface/30 p-3 rounded">
                    <div className="text-text/50 text-xs">Gas Price</div>
                    <div className="font-mono text-primary text-lg">{gasPrice} Gwei</div>
                  </div>
                  <div className="bg-surface/30 p-3 rounded">
                    <div className="text-text/50 text-xs">Pending TXs</div>
                    <div className="font-mono text-secondary text-lg">{pendingTxCount}</div>
                  </div>
                  <div className="bg-surface/30 p-3 rounded">
                    <div className="text-text/50 text-xs">Mining</div>
                    <div className={`font-mono text-lg ${isMining ? 'text-neon-green' : 'text-red-400'}`}>
                      {isMining ? 'Active' : 'Stopped'}
                    </div>
                  </div>
                  <div className="bg-surface/30 p-3 rounded">
                    <div className="text-text/50 text-xs">Hashrate</div>
                    <div className="font-mono text-primary text-lg">{hashrate}</div>
                  </div>
                  <div className="bg-surface/30 p-3 rounded">
                    <div className="text-text/50 text-xs">Sync Status</div>
                    <div className={`font-mono text-lg ${syncing ? 'text-secondary' : 'text-neon-green'}`}>
                      {syncing ? `${syncProgress.toFixed(1)}%` : 'Synced'}
                    </div>
                  </div>
                </div>
                {nodeVersion && (
                  <div className="mt-4 pt-4 border-t border-primary/20">
                    <div className="text-text/50 text-xs mb-1">Node Version</div>
                    <div className="font-mono text-xs text-text/70">{nodeVersion}</div>
                  </div>
                )}
                <div className="mt-4 pt-4 border-t border-primary/20">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text/50">Fusaka Fork</span>
                    <span className={`font-mono ${blockNumber >= 7000000 ? 'text-neon-green' : 'text-secondary'}`}>
                      Block 7,000,000 {blockNumber >= 7000000 ? '(Active)' : `(${(7000000 - blockNumber).toLocaleString()} blocks away)`}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Send Tab */}
          {activeTab === 'send' && (
            <div className="max-w-lg mx-auto">
              <div className="cyber-card p-6">
                <h2 className="text-xl font-cyber text-primary mb-6 flex items-center gap-2">
                  <Send size={20} /> Send ALT
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Recipient Address</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="cyber-input flex-1"
                        placeholder="0x..."
                        value={sendTo}
                        onChange={(e) => setSendTo(e.target.value)}
                      />
                      <button
                        onClick={() => setShowModal('selectContact')}
                        className="cyber-btn px-3"
                        title="Select from Address Book"
                      >
                        <Users size={16} />
                      </button>
                    </div>
                    {addressBook.length > 0 && sendTo === '' && (
                      <div className="mt-2">
                        <div className="text-xs text-text/50 mb-1">Recent contacts:</div>
                        <div className="flex flex-wrap gap-1">
                          {addressBook.slice(0, 3).map(contact => (
                            <button
                              key={contact.address}
                              onClick={() => setSendTo(contact.address)}
                              className="px-2 py-1 text-xs bg-surface rounded border border-primary/30 hover:border-primary/60 text-text/70 hover:text-primary transition-colors"
                            >
                              {contact.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Amount (ALT)</label>
                    <input
                      type="number"
                      className="cyber-input"
                      placeholder="0.0"
                      value={sendAmount}
                      onChange={(e) => setSendAmount(e.target.value)}
                    />
                    <div className="text-xs text-text/50 mt-1">Available: {balance} ALT</div>
                  </div>
                  <button onClick={sendTransaction} className="cyber-btn w-full mt-4">
                    Send Transaction
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Receive Tab */}
          {activeTab === 'receive' && currentWallet && (
            <div className="max-w-lg mx-auto">
              <div className="cyber-card p-6 text-center">
                <h2 className="text-xl font-cyber text-neon-green mb-6 flex items-center justify-center gap-2">
                  <Download size={20} /> Receive ALT
                </h2>
                <div className="mb-6">
                  <div className="bg-white p-4 rounded-lg inline-block">
                    <QRCodeSVG
                      value={currentWallet.address}
                      size={200}
                      level="H"
                      includeMargin={true}
                    />
                  </div>
                </div>
                <div className="text-xs text-text/50 uppercase tracking-wider mb-2">Your ALT Receive Address</div>
                <div className="font-mono text-sm text-primary bg-surface p-3 rounded break-all mb-4">
                  {currentWallet.address}
                </div>
                <button onClick={() => copyToClipboard(currentWallet.address)} className="cyber-btn cyber-btn-green">
                  <Copy size={14} className="inline mr-2" /> Copy Address
                </button>
                <div className="text-xs text-text/50 bg-secondary/10 border border-secondary/30 p-3 rounded mt-4">
                  <AlertTriangle size={14} className="inline mr-1 text-secondary" />
                  Only send <span className="text-neon-green font-semibold">ALT</span> to this address on the Altcoinchain network (Chain ID: {CHAIN_ID})
                </div>
              </div>
            </div>
          )}

          {/* Mine Tab */}
          {activeTab === 'mine' && (
            <div className="max-w-lg mx-auto">
              <div className="cyber-card p-6">
                <h2 className="text-xl font-cyber text-primary mb-6 flex items-center gap-2">
                  <Cpu size={20} /> Mining Control
                </h2>

                {/* Mining Status */}
                <div className={`p-4 rounded-lg border mb-6 ${isMining ? 'bg-neon-green/10 border-neon-green/50' : 'bg-surface/50 border-primary/20'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-text/70">Status</span>
                    <span className={`font-mono font-bold ${isMining ? 'text-neon-green' : 'text-red-400'}`}>
                      {isMining ? '⛏️ MINING' : '⏹️ STOPPED'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-text/70">Hashrate</span>
                    <span className="font-mono text-primary">{hashrate}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-text/70">Coinbase</span>
                    <span className="font-mono text-xs text-neon-green">
                      {coinbase ? `${coinbase.slice(0, 8)}...${coinbase.slice(-6)}` : 'Not set'}
                    </span>
                  </div>
                </div>

                {/* Mining Address */}
                <div className="mb-6">
                  <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Mining Reward Address</label>
                  <div className="flex gap-2">
                    <select
                      className="cyber-input flex-1"
                      value={coinbase}
                      onChange={(e) => setCoinbaseAddress(e.target.value)}
                    >
                      <option value="">Select wallet...</option>
                      {wallets.map(w => (
                        <option key={w.address} value={w.address}>
                          {w.name} ({w.address.slice(0, 8)}...)
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs text-text/50 mt-1">Mining rewards will be sent to this address</p>
                </div>

                {/* Mining Mode Selection */}
                <div className="mb-6">
                  <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Mining Mode</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setMiningMode('cpu')}
                      className={`flex-1 py-2 px-4 rounded border transition-all ${
                        miningMode === 'cpu'
                          ? 'bg-primary/20 border-primary text-primary'
                          : 'bg-surface/30 border-primary/20 text-text/50 hover:border-primary/50'
                      }`}
                    >
                      <Cpu size={16} className="inline mr-2" />
                      CPU
                    </button>
                    <button
                      onClick={() => setMiningMode('gpu')}
                      className={`flex-1 py-2 px-4 rounded border transition-all ${
                        miningMode === 'gpu'
                          ? 'bg-neon-green/20 border-neon-green text-neon-green'
                          : 'bg-surface/30 border-primary/20 text-text/50 hover:border-neon-green/50'
                      }`}
                    >
                      <Zap size={16} className="inline mr-2" />
                      GPU
                    </button>
                  </div>
                </div>

                {/* CPU Mining Options */}
                {miningMode === 'cpu' && (
                  <div className="mb-6">
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">CPU Threads</label>
                    <div className="flex items-center gap-4">
                      <input
                        type="range"
                        min="1"
                        max="16"
                        value={miningThreads}
                        onChange={(e) => setMiningThreads(parseInt(e.target.value))}
                        className="flex-1 accent-primary"
                      />
                      <span className="font-mono text-primary w-8 text-center">{miningThreads}</span>
                    </div>
                    <p className="text-xs text-text/50 mt-1">More threads = more CPU usage</p>
                  </div>
                )}

                {/* GPU Mining Options */}
                {miningMode === 'gpu' && (
                  <div className="mb-6 space-y-4">
                    <div>
                      <label className="text-xs text-text/50 uppercase tracking-wider mb-3 block">GPU Type</label>
                      <div className="space-y-2">
                        <label className="flex items-center gap-3 p-3 bg-surface/30 rounded border border-primary/20 cursor-pointer hover:border-neon-green/50 transition-colors">
                          <input
                            type="checkbox"
                            checked={gpuType === 'nvidia' || gpuType === 'both'}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setGpuType(gpuType === 'amd' ? 'both' : 'nvidia');
                              } else {
                                setGpuType(gpuType === 'both' ? 'amd' : 'nvidia');
                              }
                            }}
                            className="w-4 h-4 accent-neon-green"
                          />
                          <span className="text-neon-green font-semibold">NVIDIA (CUDA)</span>
                          <span className="text-xs text-text/50 ml-auto">GeForce GTX/RTX</span>
                        </label>
                        <label className="flex items-center gap-3 p-3 bg-surface/30 rounded border border-primary/20 cursor-pointer hover:border-red-500/50 transition-colors">
                          <input
                            type="checkbox"
                            checked={gpuType === 'amd' || gpuType === 'both'}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setGpuType(gpuType === 'nvidia' ? 'both' : 'amd');
                              } else {
                                setGpuType(gpuType === 'both' ? 'nvidia' : 'amd');
                              }
                            }}
                            className="w-4 h-4 accent-red-500"
                          />
                          <span className="text-red-400 font-semibold">AMD (OpenCL)</span>
                          <span className="text-xs text-text/50 ml-auto">Radeon RX</span>
                        </label>
                      </div>
                    </div>

                    {/* WebGPU Browser Mining */}
                    <div className="p-4 bg-surface/50 border border-secondary/30 rounded">
                      <h4 className="text-sm font-cyber text-secondary mb-3 flex items-center gap-2">
                        <Zap size={16} /> Browser GPU Mining (WebGPU)
                      </h4>
                      <WebGPUMiner
                        rpcUrl={RPC_URL}
                        walletAddress={currentWallet?.address || ''}
                        onHashrateUpdate={(hr) => console.log('WebGPU hashrate:', hr)}
                        onBlockFound={(block) => showToast(`Block found! #${block}`)}
                      />
                    </div>

                    {/* Native GPU Miner Installer */}
                    <div className="p-4 bg-surface/50 border border-primary/30 rounded">
                      <h4 className="text-sm font-cyber text-primary mb-3 flex items-center gap-2">
                        <Cpu size={16} /> Native GPU Miner (Higher Performance)
                      </h4>
                      <NativeMinerInstaller
                        rpcUrl={RPC_URL}
                        walletAddress={currentWallet?.address || ''}
                        gpuType={gpuType}
                      />
                    </div>
                  </div>
                )}

                {/* Mining Controls */}
                <div className="flex gap-3">
                  {!isMining ? (
                    <button
                      onClick={startMining}
                      disabled={syncing}
                      className="cyber-btn cyber-btn-green flex-1 flex items-center justify-center gap-2"
                    >
                      <Play size={16} /> Start Mining
                    </button>
                  ) : (
                    <button
                      onClick={stopMining}
                      className="cyber-btn flex-1 flex items-center justify-center gap-2 border-red-500 text-red-400 hover:bg-red-500/20"
                    >
                      <Square size={16} /> Stop Mining
                    </button>
                  )}
                </div>

                {syncing && (
                  <div className="mt-4 p-3 bg-secondary/10 border border-secondary/30 rounded text-sm">
                    <AlertTriangle size={14} className="inline mr-2 text-secondary" />
                    Node is still syncing ({syncProgress.toFixed(1)}%). Mining will be less effective until sync is complete.
                  </div>
                )}

                {/* Mining Info */}
                <div className="mt-6 pt-4 border-t border-primary/20">
                  <h3 className="text-sm font-cyber text-text/70 mb-3">Mining Info</h3>
                  <div className="space-y-2 text-xs text-text/50">
                    <p>• Mining uses your {miningMode === 'cpu' ? 'CPU' : 'GPU'} to solve blocks and earn ALT rewards</p>
                    {blockNumber < 7000000 ? (
                      <>
                        <p>• Current block reward: <span className="text-neon-green">2 ALT</span> (100% PoW)</p>
                        <p>• After Fusaka fork (block 7,000,000): 1 ALT PoW + 1 ALT PoS</p>
                      </>
                    ) : (
                      <>
                        <p>• Current block reward: <span className="text-neon-green">1 ALT</span> (PoW) + <span className="text-secondary">1 ALT</span> (PoS)</p>
                        <p>• <span className="text-neon-green">Fusaka fork is active!</span> Hybrid PoW/PoS enabled</p>
                      </>
                    )}
                    <p>• Block time: ~15 seconds</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Stake Tab */}
          {activeTab === 'stake' && (
            <div className="max-w-lg mx-auto">
              <div className="cyber-card p-6">
                <h2 className="text-xl font-cyber text-secondary mb-6 flex items-center gap-2">
                  <Zap size={20} /> Validator Staking
                </h2>
                <div className="bg-secondary/10 border border-secondary/30 rounded p-4 mb-6">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-secondary mt-0.5" />
                    <div className="text-sm">
                      <p className="text-secondary font-semibold">Hybrid Fork Required</p>
                      <p className="text-text/70">Staking will be available after block 7,000,000. Current: {blockNumber.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Stake Amount (Min: {MIN_STAKE} ALT)</label>
                    <input
                      type="number"
                      className="cyber-input"
                      placeholder={MIN_STAKE.toString()}
                      value={stakeAmount}
                      onChange={(e) => setStakeAmount(e.target.value)}
                    />
                  </div>
                  <div className="text-xs text-text/50">
                    <p>Contract: <span className="font-mono text-primary">{STAKING_CONTRACT}</span></p>
                    <p className="mt-1">Withdrawal delay: 7 days</p>
                  </div>
                  <button className="cyber-btn cyber-btn-secondary w-full" disabled={blockNumber < 7000000}>
                    Stake ALT
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Tokens Tab */}
          {activeTab === 'tokens' && (
            <div className="max-w-2xl mx-auto">
              {/* Sub-tabs for Tokens/NFTs */}
              <div className="flex gap-2 mb-6">
                <button
                  onClick={() => setTokenSubTab('tokens')}
                  className={`flex-1 py-3 px-4 rounded-lg font-cyber text-sm transition-all ${
                    tokenSubTab === 'tokens'
                      ? 'bg-neon-green/20 text-neon-green border border-neon-green/50'
                      : 'bg-surface/50 text-text/50 border border-primary/20 hover:border-neon-green/30'
                  }`}
                >
                  <Coins size={16} className="inline mr-2" /> Tokens
                </button>
                <button
                  onClick={() => setTokenSubTab('nfts')}
                  className={`flex-1 py-3 px-4 rounded-lg font-cyber text-sm transition-all ${
                    tokenSubTab === 'nfts'
                      ? 'bg-secondary/20 text-secondary border border-secondary/50'
                      : 'bg-surface/50 text-text/50 border border-primary/20 hover:border-secondary/30'
                  }`}
                >
                  <Image size={16} className="inline mr-2" /> NFTs
                </button>
              </div>

              {/* Tokens Sub-tab */}
              {tokenSubTab === 'tokens' && (
                <div className="cyber-card p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-cyber text-neon-green flex items-center gap-2">
                      <Coins size={20} /> ERC-20 Tokens
                    </h2>
                    <button
                      onClick={() => loadTokens()}
                      className="text-primary hover:text-primary/80 p-2"
                      title="Refresh balances"
                    >
                      <RefreshCw size={16} />
                    </button>
                  </div>
                  <div className="space-y-3 mb-6">
                    {tokens.length === 0 ? (
                      <div className="text-center text-text/50 py-8">
                        <Database size={32} className="mx-auto mb-2 opacity-50" />
                        <p>No tokens added yet</p>
                      </div>
                    ) : (
                      tokens.map((token, i) => (
                        <div key={i} className="p-4 bg-surface/50 rounded-lg border border-primary/10 hover:border-neon-green/30 transition-colors group">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-neon-green/20 flex items-center justify-center text-neon-green font-bold">
                                {token.symbol.slice(0, 2)}
                              </div>
                              <div>
                                <div className="font-semibold text-text">{token.name}</div>
                                <div className="text-xs text-text/50 font-mono flex items-center gap-2">
                                  {token.symbol}
                                  <span className="text-text/30">|</span>
                                  {token.address.slice(0, 6)}...{token.address.slice(-4)}
                                  <button
                                    onClick={() => copyToClipboard(token.address)}
                                    className="text-primary hover:text-primary/80"
                                  >
                                    <Copy size={12} />
                                  </button>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <div className={`font-mono text-lg ${token.balance === 'Error' ? 'text-red-500' : 'text-neon-green'}`}>
                                  {token.balance === 'Error' ? 'Error' : (() => {
                                    const bal = parseFloat(token.balance || '0');
                                    if (bal === 0) return '0';
                                    if (bal >= 1) return bal.toLocaleString(undefined, { maximumFractionDigits: 4 });
                                    if (bal >= 0.0001) return bal.toFixed(6);
                                    // Very small balance - show in scientific notation
                                    return bal.toExponential(4);
                                  })()}
                                </div>
                                <div className="text-xs text-text/50">{token.symbol}</div>
                              </div>
                              <button
                                onClick={() => refreshTokenBalance(token)}
                                className="p-2 text-text/50 hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Refresh balance"
                              >
                                <RefreshCw size={14} />
                              </button>
                              <button
                                onClick={() => removeToken(token.address)}
                                className="text-red-400/50 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                                title="Remove token"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                          {/* Token Actions */}
                          <div className="flex gap-2 pt-2 border-t border-primary/10">
                            <button
                              onClick={() => openTokenSend(token)}
                              className="flex-1 py-2 px-3 rounded bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors text-sm flex items-center justify-center gap-2"
                            >
                              <Send size={14} /> Send
                            </button>
                            <button
                              onClick={() => openTokenReceive(token)}
                              className="flex-1 py-2 px-3 rounded bg-neon-green/10 text-neon-green border border-neon-green/30 hover:bg-neon-green/20 transition-colors text-sm flex items-center justify-center gap-2"
                            >
                              <Download size={14} /> Receive
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <button onClick={() => setShowModal('addToken')} className="cyber-btn cyber-btn-green w-full">
                    <Plus size={14} className="inline mr-2" /> Add Custom Token
                  </button>
                </div>
              )}

              {/* NFTs Sub-tab */}
              {tokenSubTab === 'nfts' && (
                <div className="cyber-card p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-cyber text-secondary flex items-center gap-2">
                      <Image size={20} /> NFT Collection
                    </h2>
                    <button
                      onClick={() => loadNFTs()}
                      className={`text-primary hover:text-primary/80 p-2 ${loadingNFTs ? 'animate-spin' : ''}`}
                      title="Refresh NFTs"
                      disabled={loadingNFTs}
                    >
                      <RefreshCw size={16} />
                    </button>
                  </div>

                  {/* Collections Management */}
                  <div className="space-y-3 mb-6">
                    {/* Mining Game Collection */}
                    <div className="bg-secondary/10 border border-secondary/30 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-secondary font-semibold">Mining Game</span>
                            <span className="text-xs bg-secondary/20 px-2 py-0.5 rounded">ERC1155</span>
                          </div>
                          <div className="text-xs text-text/50 font-mono mt-1">
                            {DEFAULT_NFT_CONTRACT.slice(0, 10)}...{DEFAULT_NFT_CONTRACT.slice(-8)}
                            <button
                              onClick={() => copyToClipboard(DEFAULT_NFT_CONTRACT)}
                              className="text-primary hover:text-primary/80 ml-2"
                            >
                              <Copy size={10} className="inline" />
                            </button>
                          </div>
                        </div>
                        <span className="text-xs text-text/50">Built-in</span>
                      </div>
                    </div>

                    {/* Custom Collections */}
                    {customCollections.map((col, i) => (
                      <div key={i} className="bg-primary/10 border border-primary/30 rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-primary font-semibold">{col.name}</span>
                              <span className="text-xs bg-primary/20 px-2 py-0.5 rounded">{col.type}</span>
                            </div>
                            <div className="text-xs text-text/50 font-mono mt-1">
                              {col.address.slice(0, 10)}...{col.address.slice(-8)}
                              <button
                                onClick={() => copyToClipboard(col.address)}
                                className="text-primary hover:text-primary/80 ml-2"
                              >
                                <Copy size={10} className="inline" />
                              </button>
                            </div>
                          </div>
                          <button
                            onClick={() => removeCollection(col.address)}
                            className="text-red-400/50 hover:text-red-400 p-1"
                            title="Remove collection"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}

                    {/* Add Collection Button */}
                    <button
                      onClick={() => setShowModal('addNFTCollection')}
                      className="w-full p-3 border border-dashed border-primary/30 rounded-lg text-primary/70 hover:border-primary/60 hover:text-primary transition-colors flex items-center justify-center gap-2"
                    >
                      <Plus size={16} /> Add NFT Collection
                    </button>
                  </div>

                  {loadingNFTs ? (
                    <div className="text-center text-text/50 py-12">
                      <RefreshCw size={32} className="mx-auto mb-2 animate-spin text-secondary" />
                      <p>Loading NFTs...</p>
                    </div>
                  ) : nfts.length === 0 ? (
                    <div className="text-center text-text/50 py-12">
                      <Image size={48} className="mx-auto mb-4 opacity-30" />
                      <p className="text-lg mb-2">No NFTs Found</p>
                      <p className="text-sm">You don't own any Mining Game NFTs (#1-6) in this wallet</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {nfts.map((nft, i) => (
                        <div
                          key={i}
                          className="bg-surface/50 rounded-lg border border-secondary/20 overflow-hidden hover:border-secondary/50 transition-all group"
                        >
                          <div
                            className="aspect-square bg-surface relative cursor-pointer"
                            onClick={() => fetchNFTMetadata(nft)}
                          >
                            {nft.image ? (
                              <img
                                src={nft.image}
                                alt={nft.name}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                }}
                              />
                            ) : null}
                            <div className={`absolute inset-0 flex items-center justify-center ${nft.image ? 'hidden' : ''}`}>
                              <Image size={48} className="text-secondary/30" />
                            </div>
                            <div className="absolute top-2 right-2 bg-black/70 px-2 py-1 rounded text-xs text-secondary font-mono">
                              #{nft.tokenId}
                            </div>
                            {/* Balance badge */}
                            <div className="absolute top-2 left-2 bg-neon-green/90 text-black px-2 py-1 rounded text-xs font-bold">
                              x{nft.balance || 0}
                            </div>
                          </div>
                          <div className="p-3">
                            <div className="font-semibold text-sm truncate">{nft.name}</div>
                            <div className="flex items-center justify-between">
                              <div className="text-xs text-text/50">{nft.collection}</div>
                              {(nft.stakedBalance || 0) > 0 && (
                                <div className="text-xs text-secondary">+{nft.stakedBalance} staked</div>
                              )}
                            </div>
                            {/* NFT Actions */}
                            {(nft.balance || 0) > 0 && (
                              <div className="mt-2 pt-2 border-t border-secondary/20">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedNFT(nft);
                                    setNftSendAmount('1');
                                    setNftSendTo('');
                                    setShowModal('sendNFT');
                                  }}
                                  className="w-full py-1.5 px-3 rounded bg-secondary/10 text-secondary border border-secondary/30 hover:bg-secondary/20 transition-colors text-xs flex items-center justify-center gap-2"
                                >
                                  <Send size={12} /> Send NFT
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Address Book Tab */}
          {activeTab === 'addressbook' && (
            <div className="space-y-6">
              {/* Header */}
              <div className="cyber-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-cyber text-neon-green flex items-center gap-2">
                    <Users size={24} /> Address Book
                  </h2>
                  <button
                    onClick={() => {
                      setEditingContact(null);
                      setNewContactName('');
                      setNewContactAddress('');
                      setNewContactLabel('');
                      setNewContactNotes('');
                      setShowModal('addContact');
                    }}
                    className="cyber-btn flex items-center gap-2"
                  >
                    <Plus size={16} /> Add Contact
                  </button>
                </div>

                {/* Search */}
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text/50" />
                  <input
                    type="text"
                    className="cyber-input pl-10"
                    placeholder="Search contacts..."
                    value={addressBookSearch}
                    onChange={(e) => setAddressBookSearch(e.target.value)}
                  />
                </div>
              </div>

              {/* Contacts List */}
              <div className="cyber-card p-6">
                {addressBook.length === 0 ? (
                  <div className="text-center text-text/50 py-12">
                    <Users size={48} className="mx-auto mb-4 opacity-50" />
                    <p>No contacts yet</p>
                    <p className="text-sm mt-2">Add addresses you frequently send to</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {addressBook
                      .filter(contact =>
                        addressBookSearch === '' ||
                        contact.name.toLowerCase().includes(addressBookSearch.toLowerCase()) ||
                        contact.address.toLowerCase().includes(addressBookSearch.toLowerCase()) ||
                        (contact.label && contact.label.toLowerCase().includes(addressBookSearch.toLowerCase()))
                      )
                      .map((contact) => (
                        <div
                          key={contact.address}
                          className="cyber-card p-4 hover:border-primary/50 transition-colors group"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-neon-green">{contact.name}</span>
                                {contact.label && (
                                  <span className="px-2 py-0.5 rounded text-xs bg-secondary/20 text-secondary">
                                    {contact.label}
                                  </span>
                                )}
                              </div>
                              <div className="font-mono text-sm text-text/70 truncate">
                                {contact.address}
                              </div>
                              {contact.notes && (
                                <div className="text-xs text-text/50 mt-2 italic">
                                  {contact.notes}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => copyToClipboard(contact.address)}
                                className="p-2 text-text/50 hover:text-primary"
                                title="Copy address"
                              >
                                <Copy size={16} />
                              </button>
                              <button
                                onClick={() => selectContactForSend(contact.address)}
                                className="p-2 text-text/50 hover:text-neon-green"
                                title="Send to this address"
                              >
                                <Send size={16} />
                              </button>
                              <button
                                onClick={() => {
                                  setEditingContact(contact);
                                  setNewContactName(contact.name);
                                  setNewContactAddress(contact.address);
                                  setNewContactLabel(contact.label || '');
                                  setNewContactNotes(contact.notes || '');
                                  setShowModal('editContact');
                                }}
                                className="p-2 text-text/50 hover:text-secondary"
                                title="Edit contact"
                              >
                                <Settings size={16} />
                              </button>
                              <button
                                onClick={() => removeContact(contact.address)}
                                className="p-2 text-text/50 hover:text-red-500"
                                title="Delete contact"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="cyber-card p-6 w-full max-w-md relative">
            <button onClick={() => setShowModal(null)} className="absolute top-4 right-4 text-text/50 hover:text-primary">
              <X size={20} />
            </button>

            {/* Create Wallet Modal */}
            {showModal === 'createWallet' && (
              <>
                <h3 className="text-lg font-cyber text-primary mb-6">Create New Wallet</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Wallet Name</label>
                    <input
                      type="text"
                      className="cyber-input"
                      placeholder="My Wallet"
                      value={newWalletName}
                      onChange={(e) => setNewWalletName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Password</label>
                    <input
                      type="password"
                      className="cyber-input"
                      placeholder="Min 6 characters"
                      value={newWalletPassword}
                      onChange={(e) => setNewWalletPassword(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Confirm Password</label>
                    <input
                      type="password"
                      className="cyber-input"
                      placeholder="Confirm password"
                      value={newWalletPassword2}
                      onChange={(e) => setNewWalletPassword2(e.target.value)}
                    />
                  </div>
                  <button onClick={createWallet} className="cyber-btn w-full">Create Wallet</button>
                </div>
              </>
            )}

            {/* New Wallet Created Modal */}
            {showModal === 'newWalletCreated' && newWalletData && (
              <>
                <h3 className="text-lg font-cyber text-neon-green mb-6 flex items-center gap-2">
                  <Check size={20} /> Wallet Created!
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Address</label>
                    <div className="cyber-input font-mono text-sm break-all flex items-center gap-2">
                      {newWalletData.address}
                      <button onClick={() => copyToClipboard(newWalletData.address)} className="text-primary">
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block flex items-center justify-between">
                      Private Key
                      <button onClick={() => setShowPrivateKey(!showPrivateKey)} className="text-primary">
                        {showPrivateKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </label>
                    <div className="cyber-input font-mono text-sm break-all flex items-center gap-2 bg-red-900/20 border-red-500/50">
                      {showPrivateKey ? newWalletData.privateKey : '••••••••••••••••••••••••••••••••'}
                      <button onClick={() => copyToClipboard(newWalletData.privateKey)} className="text-red-400">
                        <Copy size={14} />
                      </button>
                    </div>
                    <p className="text-xs text-red-400 mt-2">⚠️ Save this key securely. Never share it!</p>
                  </div>
                  <button onClick={() => { setShowModal(null); setShowPrivateKey(false); setNewWalletData(null); }} className="cyber-btn w-full">
                    I've Saved My Key
                  </button>
                </div>
              </>
            )}

            {/* Import Wallet Modal */}
            {showModal === 'importWallet' && (
              <>
                <h3 className="text-lg font-cyber text-secondary mb-6">Import Wallet</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Private Key</label>
                    <input
                      type="password"
                      className="cyber-input"
                      placeholder="Enter private key"
                      value={importPrivateKey}
                      onChange={(e) => setImportPrivateKey(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Wallet Name</label>
                    <input
                      type="text"
                      className="cyber-input"
                      placeholder="Imported Wallet"
                      value={newWalletName}
                      onChange={(e) => setNewWalletName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Encryption Password</label>
                    <input
                      type="password"
                      className="cyber-input"
                      placeholder="Min 6 characters"
                      value={newWalletPassword}
                      onChange={(e) => setNewWalletPassword(e.target.value)}
                    />
                  </div>
                  <button onClick={importWallet} className="cyber-btn cyber-btn-secondary w-full">Import Wallet</button>
                </div>
              </>
            )}

            {/* Unlock Wallet Modal */}
            {showModal === 'unlockWallet' && (
              <>
                <h3 className="text-lg font-cyber text-primary mb-6">Unlock Wallet</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Password</label>
                    <input
                      type="password"
                      className="cyber-input"
                      placeholder="Enter wallet password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <button onClick={executeSend} className="cyber-btn w-full">Confirm Send</button>
                </div>
              </>
            )}

            {/* Export Private Key Modal */}
            {showModal === 'unlockExportKey' && (
              <>
                <h3 className="text-lg font-cyber text-primary mb-6 flex items-center gap-2">
                  <Key size={20} /> Export Private Key
                </h3>
                {!exportedPrivateKey ? (
                  <div className="space-y-4">
                    <div className="bg-red-500/10 border border-red-500/30 p-3 rounded text-sm text-red-400">
                      <AlertTriangle size={16} className="inline mr-2" />
                      Warning: Never share your private key with anyone. Anyone with your private key can steal your funds.
                    </div>
                    <div>
                      <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Wallet</label>
                      <div className="cyber-input bg-surface/50 text-text/70">{currentWallet?.name || 'No wallet selected'}</div>
                    </div>
                    <div>
                      <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Password</label>
                      <input
                        type="password"
                        className="cyber-input"
                        placeholder="Enter wallet password to decrypt"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                    <button onClick={executeExportKey} className="cyber-btn w-full">
                      <Key size={14} className="inline mr-2" /> Decrypt & Export
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-red-500/10 border border-red-500/30 p-3 rounded text-sm text-red-400">
                      <AlertTriangle size={16} className="inline mr-2" />
                      Keep this private key safe and never share it!
                    </div>
                    <div>
                      <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Your Private Key</label>
                      <div className="font-mono text-xs bg-black/50 p-3 rounded break-all text-neon-green border border-primary/30">
                        {exportedPrivateKey}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => copyToClipboard(exportedPrivateKey)} className="cyber-btn flex-1">
                        <Copy size={14} className="inline mr-2" /> Copy
                      </button>
                      <button onClick={() => { setExportedPrivateKey(''); setShowModal(null); }} className="cyber-btn cyber-btn-secondary flex-1">
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Send Token Modal */}
            {showModal === 'sendToken' && selectedToken && (
              <>
                <h3 className="text-lg font-cyber text-primary mb-6 flex items-center gap-2">
                  <Send size={20} /> Send {selectedToken.symbol}
                </h3>
                <div className="space-y-4">
                  <div className="bg-surface/50 p-3 rounded-lg border border-primary/20">
                    <div className="text-xs text-text/50 mb-1">Available Balance</div>
                    <div className="text-xl font-mono text-neon-green">
                      {parseFloat(selectedToken.balance || '0').toFixed(4)} {selectedToken.symbol}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Recipient Address</label>
                    <input
                      type="text"
                      className="cyber-input"
                      placeholder="0x..."
                      value={tokenSendTo}
                      onChange={(e) => setTokenSendTo(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Amount</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        className="cyber-input flex-1"
                        placeholder="0.0"
                        value={tokenSendAmount}
                        onChange={(e) => setTokenSendAmount(e.target.value)}
                      />
                      <button
                        onClick={() => setTokenSendAmount(selectedToken.balance || '0')}
                        className="cyber-btn px-3 text-xs"
                      >
                        MAX
                      </button>
                    </div>
                  </div>
                  <button onClick={sendToken} className="cyber-btn w-full">
                    Send {selectedToken.symbol}
                  </button>
                </div>
              </>
            )}

            {/* Unlock for Token Send Modal */}
            {showModal === 'unlockTokenSend' && selectedToken && (
              <>
                <h3 className="text-lg font-cyber text-primary mb-6">Confirm Token Transfer</h3>
                <div className="space-y-4">
                  <div className="bg-surface/50 p-4 rounded-lg border border-primary/20 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-text/50">Token</span>
                      <span className="text-neon-green font-mono">{selectedToken.symbol}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-text/50">Amount</span>
                      <span className="text-primary font-mono">{tokenSendAmount}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-text/50">To</span>
                      <span className="text-text font-mono text-xs">{tokenSendTo.slice(0, 10)}...{tokenSendTo.slice(-8)}</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Wallet Password</label>
                    <input
                      type="password"
                      className="cyber-input"
                      placeholder="Enter wallet password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <button
                    onClick={executeTokenSend}
                    disabled={sendingToken}
                    className="cyber-btn w-full"
                  >
                    {sendingToken ? (
                      <><RefreshCw size={14} className="inline mr-2 animate-spin" /> Sending...</>
                    ) : (
                      'Confirm Send'
                    )}
                  </button>
                </div>
              </>
            )}

            {/* Receive Token Modal */}
            {showModal === 'receiveToken' && selectedToken && currentWallet && (
              <>
                <h3 className="text-lg font-cyber text-neon-green mb-6 flex items-center gap-2">
                  <Download size={20} /> Receive {selectedToken.symbol}
                </h3>
                <div className="space-y-4 text-center">
                  <div className="bg-white p-4 rounded-lg inline-block mx-auto">
                    <QRCodeSVG
                      value={currentWallet.address}
                      size={180}
                      level="H"
                      includeMargin={true}
                    />
                  </div>
                  <div>
                    <div className="text-xs text-text/50 uppercase tracking-wider mb-2">Your {selectedToken.symbol} Receive Address</div>
                    <div className="font-mono text-sm text-primary bg-surface p-3 rounded break-all">
                      {currentWallet.address}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => copyToClipboard(currentWallet.address)}
                      className="cyber-btn flex-1"
                    >
                      <Copy size={14} className="inline mr-2" /> Copy Address
                    </button>
                  </div>
                  <div className="text-xs text-text/50 bg-secondary/10 border border-secondary/30 p-3 rounded">
                    <AlertTriangle size={14} className="inline mr-1 text-secondary" />
                    Only send <span className="text-neon-green font-semibold">{selectedToken.symbol}</span> to this address on the Altcoinchain network (Chain ID: {CHAIN_ID})
                  </div>
                </div>
              </>
            )}

            {/* Add Token Modal */}
            {showModal === 'addToken' && (
              <>
                <h3 className="text-lg font-cyber text-neon-green mb-6 flex items-center gap-2">
                  <Plus size={20} /> Add Custom Token
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Contract Address</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="cyber-input flex-1"
                        placeholder="0x..."
                        value={newTokenAddress}
                        onChange={(e) => setNewTokenAddress(e.target.value)}
                      />
                      <button
                        onClick={() => fetchTokenInfo(newTokenAddress)}
                        disabled={loadingTokenInfo}
                        className="cyber-btn px-3"
                        title="Auto-fetch token info"
                      >
                        {loadingTokenInfo ? (
                          <RefreshCw size={16} className="animate-spin" />
                        ) : (
                          <Search size={16} />
                        )}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Token Name</label>
                    <input
                      type="text"
                      className="cyber-input"
                      placeholder="e.g. WATT Token"
                      value={newTokenName}
                      onChange={(e) => setNewTokenName(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Symbol</label>
                      <input
                        type="text"
                        className="cyber-input"
                        placeholder="e.g. WATT"
                        value={newTokenSymbol}
                        onChange={(e) => setNewTokenSymbol(e.target.value.toUpperCase())}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Decimals</label>
                      <input
                        type="number"
                        className="cyber-input"
                        placeholder="18"
                        value={newTokenDecimals}
                        onChange={(e) => setNewTokenDecimals(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="pt-2">
                    <button onClick={addToken} className="cyber-btn cyber-btn-green w-full">
                      <Plus size={14} className="inline mr-2" /> Add Token
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Add Contact Modal */}
            {showModal === 'addContact' && (
              <>
                <h3 className="text-lg font-cyber text-neon-green mb-6 flex items-center gap-2">
                  <Users size={20} /> Add Contact
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Name *</label>
                    <input
                      type="text"
                      className="cyber-input"
                      placeholder="e.g. Alice"
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Address *</label>
                    <input
                      type="text"
                      className="cyber-input font-mono"
                      placeholder="0x..."
                      value={newContactAddress}
                      onChange={(e) => setNewContactAddress(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Label (optional)</label>
                    <input
                      type="text"
                      className="cyber-input"
                      placeholder="e.g. Exchange, Friend, Work"
                      value={newContactLabel}
                      onChange={(e) => setNewContactLabel(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Notes (optional)</label>
                    <textarea
                      className="cyber-input min-h-[80px] resize-none"
                      placeholder="Any notes about this contact..."
                      value={newContactNotes}
                      onChange={(e) => setNewContactNotes(e.target.value)}
                    />
                  </div>
                  <div className="pt-2">
                    <button onClick={addContact} className="cyber-btn cyber-btn-green w-full">
                      <Plus size={14} className="inline mr-2" /> Add Contact
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Select Contact Modal */}
            {showModal === 'selectContact' && (
              <>
                <h3 className="text-lg font-cyber text-primary mb-6 flex items-center gap-2">
                  <Users size={20} /> Select Contact
                </h3>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {addressBook.length === 0 ? (
                    <div className="text-center text-text/50 py-8">
                      <Users size={32} className="mx-auto mb-2 opacity-50" />
                      <p>No contacts in address book</p>
                      <button
                        onClick={() => setShowModal('addContact')}
                        className="cyber-btn mt-4"
                      >
                        <Plus size={14} className="inline mr-2" /> Add Contact
                      </button>
                    </div>
                  ) : (
                    addressBook.map(contact => (
                      <button
                        key={contact.address}
                        onClick={() => {
                          setSendTo(contact.address);
                          setShowModal(null);
                          showToast(`Selected: ${contact.name}`);
                        }}
                        className="w-full p-3 cyber-card hover:border-primary/50 transition-colors text-left"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-semibold text-neon-green">{contact.name}</div>
                            <div className="font-mono text-xs text-text/50 truncate">{contact.address}</div>
                          </div>
                          {contact.label && (
                            <span className="px-2 py-0.5 rounded text-xs bg-secondary/20 text-secondary">
                              {contact.label}
                            </span>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}

            {/* Edit Contact Modal */}
            {showModal === 'editContact' && editingContact && (
              <>
                <h3 className="text-lg font-cyber text-secondary mb-6 flex items-center gap-2">
                  <Settings size={20} /> Edit Contact
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Name</label>
                    <input
                      type="text"
                      className="cyber-input"
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Address</label>
                    <div className="cyber-input font-mono text-sm text-text/70 bg-surface/50">
                      {editingContact.address}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Label</label>
                    <input
                      type="text"
                      className="cyber-input"
                      placeholder="e.g. Exchange, Friend, Work"
                      value={newContactLabel}
                      onChange={(e) => setNewContactLabel(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Notes</label>
                    <textarea
                      className="cyber-input min-h-[80px] resize-none"
                      placeholder="Any notes about this contact..."
                      value={newContactNotes}
                      onChange={(e) => setNewContactNotes(e.target.value)}
                    />
                  </div>
                  <div className="pt-2">
                    <button onClick={updateContact} className="cyber-btn cyber-btn-secondary w-full">
                      <Check size={14} className="inline mr-2" /> Save Changes
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* NFT Detail Modal */}
            {showModal === 'nftDetail' && selectedNFT && (
              <>
                <h3 className="text-lg font-cyber text-secondary mb-4 flex items-center gap-2">
                  <Image size={20} /> {selectedNFT.name}
                </h3>
                <div className="space-y-4 max-h-[70vh] overflow-y-auto">
                  {/* NFT Image */}
                  <div className="aspect-square bg-surface rounded-lg overflow-hidden relative max-w-[300px] mx-auto">
                    {loadingNFTMetadata ? (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <RefreshCw size={32} className="animate-spin text-secondary" />
                      </div>
                    ) : nftMetadata?.image ? (
                      <img
                        src={nftMetadata.image}
                        alt={selectedNFT.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Image size={64} className="text-secondary/30" />
                      </div>
                    )}
                    <div className="absolute top-2 right-2 bg-black/70 px-2 py-1 rounded text-xs text-secondary font-mono">
                      #{selectedNFT.tokenId}
                    </div>
                  </div>

                  {/* NFT Info */}
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-text/50 uppercase tracking-wider">Collection</label>
                      <div className="text-text">{selectedNFT.collection || 'Mining Game'}</div>
                    </div>

                    {nftMetadata?.description && (
                      <div>
                        <label className="text-xs text-text/50 uppercase tracking-wider">Description</label>
                        <div className="text-text/80 text-sm">{nftMetadata.description}</div>
                      </div>
                    )}

                    <div>
                      <label className="text-xs text-text/50 uppercase tracking-wider">Contract</label>
                      <div className="font-mono text-xs text-text/70 flex items-center gap-2">
                        {selectedNFT.address.slice(0, 10)}...{selectedNFT.address.slice(-8)}
                        <button onClick={() => copyToClipboard(selectedNFT.address)} className="text-primary hover:text-primary/80">
                          <Copy size={12} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Traits/Attributes */}
                  {nftMetadata?.attributes && nftMetadata.attributes.length > 0 && (
                    <div>
                      <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Traits</label>
                      <div className="grid grid-cols-2 gap-2">
                        {nftMetadata.attributes.map((trait, i) => (
                          <div key={i} className="bg-surface/50 rounded p-2 border border-secondary/20">
                            <div className="text-xs text-secondary uppercase">{trait.trait_type}</div>
                            <div className="text-sm font-semibold text-text truncate">
                              {trait.display_type === 'number' ? Number(trait.value).toLocaleString() : trait.value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Properties (alternative format) */}
                  {nftMetadata?.properties && Object.keys(nftMetadata.properties).length > 0 && !nftMetadata.attributes && (
                    <div>
                      <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Properties</label>
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(nftMetadata.properties).map(([key, value], i) => (
                          <div key={i} className="bg-surface/50 rounded p-2 border border-secondary/20">
                            <div className="text-xs text-secondary uppercase">{key}</div>
                            <div className="text-sm font-semibold text-text truncate">
                              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Loading state for metadata */}
                  {loadingNFTMetadata && (
                    <div className="text-center text-text/50 py-4">
                      <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
                      <p className="text-sm">Loading NFT metadata...</p>
                    </div>
                  )}

                  {/* No traits message */}
                  {!loadingNFTMetadata && !nftMetadata?.attributes && !nftMetadata?.properties && (
                    <div className="text-center text-text/50 py-4">
                      <p className="text-sm">No traits available for this NFT</p>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Send NFT Modal */}
            {showModal === 'sendNFT' && selectedNFT && (
              <>
                <h3 className="text-lg font-cyber text-secondary mb-4 flex items-center gap-2">
                  <Send size={20} /> Send NFT
                </h3>
                <div className="space-y-4">
                  {/* NFT Preview */}
                  <div className="flex items-center gap-4 p-3 bg-surface/50 rounded-lg border border-secondary/20">
                    <div className="w-16 h-16 bg-surface rounded overflow-hidden flex-shrink-0">
                      {selectedNFT.image ? (
                        <img src={selectedNFT.image} alt={selectedNFT.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Image size={24} className="text-secondary/30" />
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="font-semibold text-text">{selectedNFT.name}</div>
                      <div className="text-xs text-text/50">Token ID: #{selectedNFT.tokenId}</div>
                      <div className="text-xs text-neon-green">Available: {selectedNFT.balance}</div>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Recipient Address</label>
                    <input
                      type="text"
                      className="cyber-input font-mono"
                      placeholder="0x..."
                      value={nftSendTo}
                      onChange={(e) => setNftSendTo(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Amount to Send</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        className="cyber-input flex-1"
                        min="1"
                        max={selectedNFT.balance || 1}
                        value={nftSendAmount}
                        onChange={(e) => setNftSendAmount(e.target.value)}
                      />
                      <button
                        onClick={() => setNftSendAmount(String(selectedNFT.balance || 1))}
                        className="px-3 py-2 bg-secondary/20 text-secondary rounded text-sm hover:bg-secondary/30"
                      >
                        Max
                      </button>
                    </div>
                    <div className="text-xs text-text/50 mt-1">
                      You have {selectedNFT.balance} of this NFT
                    </div>
                  </div>

                  <div className="pt-2">
                    <button onClick={sendNFT} className="cyber-btn cyber-btn-secondary w-full">
                      <Send size={14} className="inline mr-2" /> Continue
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Add NFT Collection Modal */}
            {showModal === 'addNFTCollection' && (
              <>
                <h3 className="text-lg font-cyber text-primary mb-4 flex items-center gap-2">
                  <Plus size={20} /> Add NFT Collection
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Contract Address</label>
                    <input
                      type="text"
                      className="cyber-input font-mono"
                      placeholder="0x..."
                      value={newCollectionAddress}
                      onChange={(e) => setNewCollectionAddress(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Collection Name</label>
                    <input
                      type="text"
                      className="cyber-input"
                      placeholder="e.g. My NFT Collection"
                      value={newCollectionName}
                      onChange={(e) => setNewCollectionName(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Token Type</label>
                      <select
                        className="cyber-input"
                        value={newCollectionType}
                        onChange={(e) => setNewCollectionType(e.target.value as 'ERC1155' | 'ERC721')}
                      >
                        <option value="ERC1155">ERC1155 (Multi-token)</option>
                        <option value="ERC721">ERC721 (Single token)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Max Token ID</label>
                      <input
                        type="number"
                        className="cyber-input"
                        placeholder="10"
                        min="1"
                        max="100"
                        value={newCollectionMaxId}
                        onChange={(e) => setNewCollectionMaxId(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="text-xs text-text/50 bg-surface/50 p-3 rounded">
                    <p className="mb-1"><strong>Note:</strong> The wallet will scan token IDs 1 through {newCollectionMaxId || 10}.</p>
                    <p>For large collections, keep this number low to avoid slow loading.</p>
                  </div>

                  <div className="pt-2">
                    <button onClick={addCollection} className="cyber-btn w-full">
                      <Plus size={14} className="inline mr-2" /> Add Collection
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Unlock NFT Send Modal */}
            {showModal === 'unlockNFTSend' && selectedNFT && (
              <>
                <h3 className="text-lg font-cyber text-secondary mb-4">Confirm NFT Transfer</h3>
                <div className="space-y-4">
                  <div className="bg-secondary/10 border border-secondary/30 rounded p-3">
                    <div className="text-sm text-text/70 mb-2">You are sending:</div>
                    <div className="font-semibold text-secondary">{nftSendAmount}x {selectedNFT.name}</div>
                    <div className="text-xs text-text/50 mt-1">To: {nftSendTo.slice(0, 10)}...{nftSendTo.slice(-8)}</div>
                  </div>

                  <div>
                    <label className="text-xs text-text/50 uppercase tracking-wider mb-2 block">Wallet Password</label>
                    <input
                      type="password"
                      className="cyber-input"
                      placeholder="Enter your wallet password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>

                  <button
                    onClick={executeNFTSend}
                    disabled={sendingNFT || !password}
                    className="cyber-btn cyber-btn-secondary w-full disabled:opacity-50"
                  >
                    {sendingNFT ? (
                      <>
                        <RefreshCw size={14} className="inline mr-2 animate-spin" /> Sending...
                      </>
                    ) : (
                      <>
                        <Send size={14} className="inline mr-2" /> Send NFT
                      </>
                    )}
                  </button>

                  <div className="text-xs text-center text-text/50">
                    <AlertTriangle size={12} className="inline mr-1" />
                    NFT transfers cannot be reversed
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* About Modal */}
      {showModal === 'about' && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[200] backdrop-blur-sm">
          <div className="bg-surface border border-primary/30 rounded-lg p-6 w-full max-w-md relative shadow-2xl">
            <button onClick={() => setShowModal(null)} className="absolute top-4 right-4 text-text/50 hover:text-primary">
              <X size={20} />
            </button>
            <div className="text-center">
              <img src="/icon.png" alt="Altcoinchain" className="w-20 h-20 mx-auto mb-4" onError={(e) => e.currentTarget.style.display = 'none'} />
              <h3 className="text-2xl font-cyber text-primary mb-2">Altcoinchain Wallet</h3>
              <p className="text-text/70 mb-4">Version 2.0.0</p>
              <div className="text-sm text-text/50 space-y-2">
                <p>Chain ID: {CHAIN_ID}</p>
                <p>RPC: {RPC_URL}</p>
                <p className="mt-4">A decentralized cryptocurrency wallet for the Altcoinchain network.</p>
              </div>
              <div className="mt-6 pt-4 border-t border-primary/20">
                <button onClick={() => window.open('https://altcoinchain.org', '_blank')} className="cyber-btn text-sm">
                  <ExternalLink size={14} className="inline mr-2" /> Visit Website
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Console Window */}
      {showConsole && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[200] backdrop-blur-sm">
          <div className="bg-surface border border-primary/30 rounded-lg w-full max-w-3xl h-[500px] relative shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-primary/20 bg-background/50">
              <div className="flex items-center gap-2">
                <Terminal size={18} className="text-primary" />
                <span className="font-cyber text-primary">Debug Console</span>
              </div>
              <button onClick={() => setShowConsole(false)} className="text-text/50 hover:text-primary">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 font-mono text-sm bg-black/30">
              {consoleHistory.map((entry, i) => (
                <div key={i} className={`mb-1 ${
                  entry.type === 'input' ? 'text-primary' :
                  entry.type === 'error' ? 'text-red-400' : 'text-text/80'
                }`}>
                  <pre className="whitespace-pre-wrap">{entry.text}</pre>
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-primary/20 flex gap-2">
              <span className="text-primary font-mono">&gt;</span>
              <input
                type="text"
                className="flex-1 bg-transparent border-none outline-none font-mono text-text"
                placeholder="Enter command..."
                value={consoleInput}
                onChange={(e) => setConsoleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && consoleInput.trim()) {
                    executeConsoleCommand(consoleInput.trim());
                    setConsoleInput('');
                  }
                }}
                autoFocus
              />
            </div>
          </div>
        </div>
      )}

      {/* Network Info Window */}
      {showNetworkInfo && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[200] backdrop-blur-sm">
          <div className="bg-surface border border-primary/30 rounded-lg w-full max-w-md relative shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-primary/20 bg-background/50">
              <div className="flex items-center gap-2">
                <Globe size={18} className="text-primary" />
                <span className="font-cyber text-primary">Network Information</span>
              </div>
              <button onClick={() => setShowNetworkInfo(false)} className="text-text/50 hover:text-primary">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-3 font-mono text-sm">
              <div className="flex justify-between">
                <span className="text-text/50">Chain ID:</span>
                <span className="text-primary">{networkId || CHAIN_ID}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text/50">Network:</span>
                <span className="text-primary">Altcoinchain Mainnet</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text/50">RPC URL:</span>
                <span className="text-primary">{RPC_URL}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text/50">Block Height:</span>
                <span className="text-neon-green">{blockNumber.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text/50">Peer Count:</span>
                <span className="text-neon-green">{peerCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text/50">Gas Price:</span>
                <span className="text-neon-green">{gasPrice} Gwei</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text/50">Node Version:</span>
                <span className="text-primary text-xs">{nodeVersion || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text/50">Syncing:</span>
                <span className={syncing ? 'text-secondary' : 'text-neon-green'}>{syncing ? `${syncProgress.toFixed(1)}%` : 'Synced'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Peers Window */}
      {showPeers && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[200] backdrop-blur-sm">
          <div className="bg-surface border border-primary/30 rounded-lg w-full max-w-2xl max-h-[500px] relative shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-primary/20 bg-background/50">
              <div className="flex items-center gap-2">
                <Users size={18} className="text-primary" />
                <span className="font-cyber text-primary">Connected Peers ({peers.length})</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={fetchPeers} className="text-text/50 hover:text-primary">
                  <RefreshCw size={16} />
                </button>
                <button onClick={() => setShowPeers(false)} className="text-text/50 hover:text-primary">
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {peers.length === 0 ? (
                <div className="text-center text-text/50 py-8">
                  <Users size={32} className="mx-auto mb-2 opacity-50" />
                  <p>No peers connected or peer info unavailable</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {peers.map((peer, i) => (
                    <div key={i} className="bg-background/50 p-3 rounded border border-primary/10 font-mono text-xs">
                      <div className="flex justify-between mb-1">
                        <span className="text-primary">{peer.name || 'Unknown'}</span>
                        <span className="text-text/50">{peer.network?.remoteAddress || 'N/A'}</span>
                      </div>
                      <div className="text-text/40 truncate">{peer.enode || peer.id || 'No enode'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded-lg z-[300] font-body tracking-wide ${
          toast.type === 'success' ? 'bg-neon-green/90 text-black' : 'bg-red-500/90 text-white'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default App;
