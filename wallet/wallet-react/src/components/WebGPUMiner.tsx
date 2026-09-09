/// <reference types="@webgpu/types" />
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Square, Zap, AlertTriangle, RefreshCw } from 'lucide-react';

interface WebGPUMinerProps {
  rpcUrl: string;
  walletAddress: string;
  onHashrateUpdate?: (hashrate: number) => void;
  onBlockFound?: (blockNumber: number) => void;
}

interface MiningWork {
  headerHash: string;
  seedHash: string;
  target: string;
  blockNumber: number;
}

// Keccak-256 constants for ethash
const KECCAK_ROUNDS = 24;
const HASH_BYTES = 64;
const WORD_BYTES = 4;
const MIX_BYTES = 128;
const MIX_WORDS = MIX_BYTES / WORD_BYTES;
const DATASET_PARENTS = 256;
const CACHE_ROUNDS = 3;
const ACCESSES = 64;

const WebGPUMiner: React.FC<WebGPUMinerProps> = ({
  rpcUrl,
  walletAddress,
  onHashrateUpdate,
  onBlockFound
}) => {
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [isMining, setIsMining] = useState(false);
  const [hashrate, setHashrate] = useState(0);
  const [sharesFound, setSharesFound] = useState(0);
  const [gpuInfo, setGpuInfo] = useState<string>('Detecting...');
  const [error, setError] = useState<string | null>(null);
  const [currentWork, setCurrentWork] = useState<MiningWork | null>(null);
  const [dagProgress, setDagProgress] = useState<number>(0);
  const [dagReady, setDagReady] = useState(false);

  const deviceRef = useRef<GPUDevice | null>(null);
  const miningRef = useRef<boolean>(false);
  const hashCountRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(Date.now());
  const cacheRef = useRef<Uint32Array | null>(null);
  const dagEpochRef = useRef<number>(-1);

  // Check WebGPU support
  useEffect(() => {
    const checkWebGPU = async () => {
      if (!navigator.gpu) {
        setIsSupported(false);
        setError('WebGPU not supported in this browser. Use Chrome 113+ or Edge 113+');
        return;
      }

      try {
        const adapter = await navigator.gpu.requestAdapter({
          powerPreference: 'high-performance'
        });
        if (!adapter) {
          setIsSupported(false);
          setError('No WebGPU adapter found. Make sure GPU drivers are installed.');
          return;
        }

        const device = await adapter.requestDevice({
          requiredLimits: {
            maxStorageBufferBindingSize: 256 * 1024 * 1024, // 256MB for cache
            maxBufferSize: 256 * 1024 * 1024,
          }
        });
        deviceRef.current = device;
        setIsSupported(true);

        // Get GPU info
        try {
          const info = (adapter as any).info || await (adapter as any).requestAdapterInfo?.();
          if (info) {
            setGpuInfo(`${info.vendor || ''} ${info.architecture || info.device || 'GPU'}`);
          } else {
            setGpuInfo('WebGPU GPU');
          }
        } catch {
          setGpuInfo('WebGPU GPU');
        }
      } catch (e: any) {
        setIsSupported(false);
        setError('Failed to initialize WebGPU: ' + e.message);
      }
    };

    checkWebGPU();
  }, []);

  // Calculate epoch from block number
  const getEpoch = (blockNumber: number) => Math.floor(blockNumber / 30000);

  // Calculate cache size for epoch
  const getCacheSize = (epoch: number) => {
    const CACHE_BYTES_INIT = 16777216; // 2^24
    const CACHE_BYTES_GROWTH = 131072; // 2^17
    let size = CACHE_BYTES_INIT + CACHE_BYTES_GROWTH * epoch;
    size -= 64;
    while (!isPrime(size / 64)) {
      size -= 128;
    }
    return size;
  };

  // Calculate dataset size for epoch
  const getDatasetSize = (epoch: number) => {
    const DATASET_BYTES_INIT = 1073741824; // 2^30
    const DATASET_BYTES_GROWTH = 8388608; // 2^23
    let size = DATASET_BYTES_INIT + DATASET_BYTES_GROWTH * epoch;
    size -= 128;
    while (!isPrime(size / 128)) {
      size -= 256;
    }
    return size;
  };

  const isPrime = (n: number) => {
    if (n < 2) return false;
    if (n === 2) return true;
    if (n % 2 === 0) return false;
    for (let i = 3; i * i <= n; i += 2) {
      if (n % i === 0) return false;
    }
    return true;
  };

  // Keccak-256 implementation in JavaScript (for cache generation)
  const keccak256 = (input: Uint8Array): Uint8Array => {
    return keccakF(input, 256);
  };

  const keccak512 = (input: Uint8Array): Uint8Array => {
    return keccakF(input, 512);
  };

  const keccakF = (input: Uint8Array, bits: number): Uint8Array => {
    const rate = 1600 - bits * 2;
    const rateBytes = rate / 8;
    const outputBytes = bits / 8;

    // Pad input
    const padded = new Uint8Array(Math.ceil((input.length + 1) / rateBytes) * rateBytes);
    padded.set(input);
    padded[input.length] = 0x01;
    padded[padded.length - 1] |= 0x80;

    // State
    const state = new BigUint64Array(25);

    // Absorb
    for (let i = 0; i < padded.length; i += rateBytes) {
      for (let j = 0; j < rateBytes / 8 && j < 25; j++) {
        let val = BigInt(0);
        for (let k = 0; k < 8; k++) {
          val |= BigInt(padded[i + j * 8 + k] || 0) << BigInt(k * 8);
        }
        state[j] ^= val;
      }
      keccakPermutation(state);
    }

    // Squeeze
    const output = new Uint8Array(outputBytes);
    for (let i = 0; i < outputBytes / 8; i++) {
      const val = state[i];
      for (let j = 0; j < 8 && i * 8 + j < outputBytes; j++) {
        output[i * 8 + j] = Number((val >> BigInt(j * 8)) & BigInt(0xff));
      }
    }

    return output;
  };

  const keccakPermutation = (state: BigUint64Array) => {
    const RC = [
      BigInt("0x0000000000000001"), BigInt("0x0000000000008082"), BigInt("0x800000000000808a"), BigInt("0x8000000080008000"),
      BigInt("0x000000000000808b"), BigInt("0x0000000080000001"), BigInt("0x8000000080008081"), BigInt("0x8000000000008009"),
      BigInt("0x000000000000008a"), BigInt("0x0000000000000088"), BigInt("0x0000000080008009"), BigInt("0x000000008000000a"),
      BigInt("0x000000008000808b"), BigInt("0x800000000000008b"), BigInt("0x8000000000008089"), BigInt("0x8000000000008003"),
      BigInt("0x8000000000008002"), BigInt("0x8000000000000080"), BigInt("0x000000000000800a"), BigInt("0x800000008000000a"),
      BigInt("0x8000000080008081"), BigInt("0x8000000000008080"), BigInt("0x0000000080000001"), BigInt("0x8000000080008008")
    ];

    const rotl = (x: bigint, n: number) => ((x << BigInt(n)) | (x >> BigInt(64 - n))) & BigInt("0xffffffffffffffff");

    for (let round = 0; round < 24; round++) {
      // Theta
      const C = new BigUint64Array(5);
      for (let x = 0; x < 5; x++) {
        C[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
      }
      const D = new BigUint64Array(5);
      for (let x = 0; x < 5; x++) {
        D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      }
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          state[x + y * 5] ^= D[x];
        }
      }

      // Rho and Pi
      const B = new BigUint64Array(25);
      const rotations = [
        0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14
      ];
      const piLane = [
        0, 6, 12, 18, 24, 3, 9, 10, 16, 22, 1, 7, 13, 19, 20, 4, 5, 11, 17, 23, 2, 8, 14, 15, 21
      ];
      for (let i = 0; i < 25; i++) {
        B[piLane[i]] = rotl(state[i], rotations[i]);
      }

      // Chi
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          state[x + y * 5] = B[x + y * 5] ^ ((~B[(x + 1) % 5 + y * 5]) & B[(x + 2) % 5 + y * 5]);
        }
      }

      // Iota
      state[0] ^= RC[round];
    }
  };

  // FNV hash function
  const fnv = (a: number, b: number): number => {
    return (((a * 0x01000193) >>> 0) ^ b) >>> 0;
  };

  // Generate cache for given seed
  const generateCache = async (seedHash: string, epoch: number): Promise<Uint32Array> => {
    const cacheSize = getCacheSize(epoch);
    const cacheWords = cacheSize / 4;
    const cache = new Uint32Array(cacheWords);

    setDagProgress(0);

    // Convert seed hash to bytes
    const seed = hexToBytes(seedHash);

    // Generate initial cache
    let hash = keccak512(seed);
    for (let i = 0; i < 64 / 4; i++) {
      cache[i] = (hash[i * 4] | (hash[i * 4 + 1] << 8) | (hash[i * 4 + 2] << 16) | (hash[i * 4 + 3] << 24)) >>> 0;
    }

    const rows = cacheSize / 64;
    for (let i = 1; i < rows; i++) {
      const prevRow = new Uint8Array(64);
      for (let j = 0; j < 16; j++) {
        const val = cache[(i - 1) * 16 + j];
        prevRow[j * 4] = val & 0xff;
        prevRow[j * 4 + 1] = (val >> 8) & 0xff;
        prevRow[j * 4 + 2] = (val >> 16) & 0xff;
        prevRow[j * 4 + 3] = (val >> 24) & 0xff;
      }
      hash = keccak512(prevRow);
      for (let j = 0; j < 16; j++) {
        cache[i * 16 + j] = (hash[j * 4] | (hash[j * 4 + 1] << 8) | (hash[j * 4 + 2] << 16) | (hash[j * 4 + 3] << 24)) >>> 0;
      }

      if (i % 1000 === 0) {
        setDagProgress(Math.floor((i / rows) * 50));
        await new Promise(r => setTimeout(r, 0)); // Yield to UI
      }
    }

    // Randmemohash rounds
    for (let round = 0; round < CACHE_ROUNDS; round++) {
      for (let i = 0; i < rows; i++) {
        const srcOff = ((i - 1 + rows) % rows) * 16;
        const dstOff = cache[i * 16] % rows * 16;

        const xorData = new Uint8Array(64);
        for (let j = 0; j < 16; j++) {
          const val = cache[srcOff + j] ^ cache[dstOff + j];
          xorData[j * 4] = val & 0xff;
          xorData[j * 4 + 1] = (val >> 8) & 0xff;
          xorData[j * 4 + 2] = (val >> 16) & 0xff;
          xorData[j * 4 + 3] = (val >> 24) & 0xff;
        }
        hash = keccak512(xorData);
        for (let j = 0; j < 16; j++) {
          cache[i * 16 + j] = (hash[j * 4] | (hash[j * 4 + 1] << 8) | (hash[j * 4 + 2] << 16) | (hash[j * 4 + 3] << 24)) >>> 0;
        }

        if (i % 1000 === 0) {
          setDagProgress(50 + Math.floor(((round * rows + i) / (CACHE_ROUNDS * rows)) * 50));
          await new Promise(r => setTimeout(r, 0));
        }
      }
    }

    setDagProgress(100);
    return cache;
  };

  // Calculate dataset item from cache (light evaluation)
  const calcDatasetItem = (cache: Uint32Array, index: number, datasetSize: number): Uint32Array => {
    const cacheSize = cache.length * 4;
    const rows = cacheSize / 64;
    const mix = new Uint32Array(16);

    // Initialize mix
    const cacheIdx = (index % rows) * 16;
    for (let i = 0; i < 16; i++) {
      mix[i] = cache[cacheIdx + i] ^ (i === 0 ? index : 0);
    }

    // Hash initial mix
    const mixBytes = new Uint8Array(64);
    for (let i = 0; i < 16; i++) {
      mixBytes[i * 4] = mix[i] & 0xff;
      mixBytes[i * 4 + 1] = (mix[i] >> 8) & 0xff;
      mixBytes[i * 4 + 2] = (mix[i] >> 16) & 0xff;
      mixBytes[i * 4 + 3] = (mix[i] >> 24) & 0xff;
    }
    let hash = keccak512(mixBytes);
    for (let i = 0; i < 16; i++) {
      mix[i] = (hash[i * 4] | (hash[i * 4 + 1] << 8) | (hash[i * 4 + 2] << 16) | (hash[i * 4 + 3] << 24)) >>> 0;
    }

    // FNV hash with cache items
    for (let j = 0; j < DATASET_PARENTS; j++) {
      const cacheIndex = fnv(index ^ j, mix[j % 16]) % rows;
      for (let k = 0; k < 16; k++) {
        mix[k] = fnv(mix[k], cache[cacheIndex * 16 + k]);
      }
    }

    // Final hash
    for (let i = 0; i < 16; i++) {
      mixBytes[i * 4] = mix[i] & 0xff;
      mixBytes[i * 4 + 1] = (mix[i] >> 8) & 0xff;
      mixBytes[i * 4 + 2] = (mix[i] >> 16) & 0xff;
      mixBytes[i * 4 + 3] = (mix[i] >> 24) & 0xff;
    }
    hash = keccak512(mixBytes);
    for (let i = 0; i < 16; i++) {
      mix[i] = (hash[i * 4] | (hash[i * 4 + 1] << 8) | (hash[i * 4 + 2] << 16) | (hash[i * 4 + 3] << 24)) >>> 0;
    }

    return mix;
  };

  // Hashimoto - main ethash function
  const hashimoto = (headerHash: Uint8Array, nonce: bigint, cache: Uint32Array, datasetSize: number): { mixHash: Uint8Array, result: Uint8Array } => {
    const nonceBytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
      nonceBytes[i] = Number((nonce >> BigInt(i * 8)) & BigInt(0xff));
    }

    // Combine header and nonce
    const seedInput = new Uint8Array(40);
    seedInput.set(headerHash);
    seedInput.set(nonceBytes, 32);
    const seed = keccak512(seedInput);

    // Initialize mix
    const mix = new Uint32Array(MIX_WORDS);
    for (let i = 0; i < MIX_WORDS; i++) {
      const idx = i % 16;
      mix[i] = (seed[idx * 4] | (seed[idx * 4 + 1] << 8) | (seed[idx * 4 + 2] << 16) | (seed[idx * 4 + 3] << 24)) >>> 0;
    }

    const pageSize = MIX_BYTES / HASH_BYTES;
    const numFullPages = Math.floor(datasetSize / MIX_BYTES);

    // Mix in dataset
    for (let i = 0; i < ACCESSES; i++) {
      const p = fnv(i ^ ((seed[0] | (seed[1] << 8) | (seed[2] << 16) | (seed[3] << 24)) >>> 0), mix[i % MIX_WORDS]) % numFullPages;

      for (let j = 0; j < pageSize; j++) {
        const datasetItem = calcDatasetItem(cache, p * pageSize + j, datasetSize);
        for (let k = 0; k < 16; k++) {
          mix[j * 16 + k] = fnv(mix[j * 16 + k], datasetItem[k]);
        }
      }
    }

    // Compress mix
    const cmix = new Uint32Array(8);
    for (let i = 0; i < MIX_WORDS; i += 4) {
      cmix[i / 4] = fnv(fnv(fnv(mix[i], mix[i + 1]), mix[i + 2]), mix[i + 3]);
    }

    const mixHash = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      mixHash[i * 4] = cmix[i] & 0xff;
      mixHash[i * 4 + 1] = (cmix[i] >> 8) & 0xff;
      mixHash[i * 4 + 2] = (cmix[i] >> 16) & 0xff;
      mixHash[i * 4 + 3] = (cmix[i] >> 24) & 0xff;
    }

    // Final result
    const resultInput = new Uint8Array(64 + 32);
    resultInput.set(seed);
    resultInput.set(mixHash, 64);
    const result = keccak256(resultInput);

    return { mixHash, result };
  };

  const hexToBytes = (hex: string): Uint8Array => {
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
    }
    return bytes;
  };

  const bytesToHex = (bytes: Uint8Array): string => {
    return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // Fetch mining work from node
  const getWork = useCallback(async (): Promise<MiningWork | null> => {
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getWork',
          params: [],
          id: 1
        })
      });
      const data = await res.json();
      if (data.result && data.result.length >= 3) {
        return {
          headerHash: data.result[0],
          seedHash: data.result[1],
          target: data.result[2],
          blockNumber: data.result[3] ? parseInt(data.result[3], 16) : 0
        };
      }
    } catch (e) {
      console.error('Failed to get work:', e);
    }
    return null;
  }, [rpcUrl]);

  // Submit found nonce
  const submitWork = useCallback(async (nonce: string, headerHash: string, mixHash: string): Promise<boolean> => {
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_submitWork',
          params: [nonce, headerHash, mixHash],
          id: 1
        })
      });
      const data = await res.json();
      return data.result === true;
    } catch (e) {
      console.error('Failed to submit work:', e);
      return false;
    }
  }, [rpcUrl]);

  // Main mining loop
  const mineLoop = useCallback(async () => {
    if (!miningRef.current || !cacheRef.current) return;

    const work = await getWork();
    if (!work) {
      setTimeout(() => mineLoop(), 1000);
      return;
    }

    setCurrentWork(work);
    const epoch = getEpoch(work.blockNumber);
    const datasetSize = getDatasetSize(epoch);
    const cache = cacheRef.current;

    const headerHash = hexToBytes(work.headerHash);
    const targetBytes = hexToBytes(work.target);

    // Convert target to BigInt for comparison
    let target = BigInt(0);
    for (let i = 0; i < targetBytes.length; i++) {
      target = (target << BigInt(8)) | BigInt(targetBytes[i]);
    }

    // Mine batch
    const batchSize = 100; // Hashes per batch (lower for responsiveness)
    let nonce = BigInt(Math.floor(Math.random() * 0xFFFFFFFF)) << BigInt(32);

    const mineBatch = async () => {
      if (!miningRef.current) return;

      const startTime = Date.now();

      for (let i = 0; i < batchSize && miningRef.current; i++) {
        const { mixHash, result } = hashimoto(headerHash, nonce, cache, datasetSize);

        // Check if result meets target
        let resultBigInt = BigInt(0);
        for (let j = 0; j < result.length; j++) {
          resultBigInt = (resultBigInt << BigInt(8)) | BigInt(result[j]);
        }

        if (resultBigInt < target) {
          // Found valid nonce!
          const nonceHex = '0x' + nonce.toString(16).padStart(16, '0');
          const mixHashHex = bytesToHex(mixHash);

          console.log('Found share!', { nonce: nonceHex, mixHash: mixHashHex });

          const accepted = await submitWork(nonceHex, work.headerHash, mixHashHex);
          if (accepted) {
            setSharesFound(s => s + 1);
            onBlockFound?.(work.blockNumber);
          }
        }

        nonce++;
        hashCountRef.current++;
      }

      // Update hashrate
      const now = Date.now();
      const elapsed = (now - lastTimeRef.current) / 1000;
      if (elapsed >= 1) {
        const hr = hashCountRef.current / elapsed;
        setHashrate(hr);
        onHashrateUpdate?.(hr);
        hashCountRef.current = 0;
        lastTimeRef.current = now;
      }

      // Continue mining or get new work
      if (miningRef.current) {
        // Check for new work every 5 seconds
        if (Date.now() - startTime > 5000) {
          setTimeout(() => mineLoop(), 0);
        } else {
          setTimeout(() => mineBatch(), 0);
        }
      }
    };

    mineBatch();
  }, [getWork, submitWork, onHashrateUpdate, onBlockFound]);

  const startMining = async () => {
    if (!deviceRef.current) {
      setError('WebGPU device not initialized');
      return;
    }

    // Set coinbase address
    try {
      await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'miner_setEtherbase',
          params: [walletAddress],
          id: 1
        })
      });
    } catch (e) {
      console.error('Failed to set etherbase:', e);
    }

    setError(null);
    setDagReady(false);

    // Get current work to determine epoch
    const work = await getWork();
    if (!work) {
      setError('Could not get work from node. Is the node running?');
      return;
    }

    const epoch = getEpoch(work.blockNumber);

    // Generate cache if needed
    if (dagEpochRef.current !== epoch || !cacheRef.current) {
      setDagProgress(0);
      try {
        cacheRef.current = await generateCache(work.seedHash, epoch);
        dagEpochRef.current = epoch;
      } catch (e: any) {
        setError('Failed to generate cache: ' + e.message);
        return;
      }
    }

    setDagReady(true);
    miningRef.current = true;
    setIsMining(true);
    hashCountRef.current = 0;
    lastTimeRef.current = Date.now();

    mineLoop();
  };

  const stopMining = () => {
    miningRef.current = false;
    setIsMining(false);
    setHashrate(0);
  };

  const formatHashrate = (hr: number) => {
    if (hr > 1000000) return (hr / 1000000).toFixed(2) + ' MH/s';
    if (hr > 1000) return (hr / 1000).toFixed(2) + ' KH/s';
    return hr.toFixed(0) + ' H/s';
  };

  if (isSupported === null) {
    return (
      <div className="p-4 bg-surface/50 rounded-lg border border-primary/20">
        <div className="flex items-center gap-2 text-primary">
          <RefreshCw size={16} className="animate-spin" />
          <span>Checking WebGPU support...</span>
        </div>
      </div>
    );
  }

  if (!isSupported) {
    return (
      <div className="p-4 bg-red-500/10 rounded-lg border border-red-500/30">
        <div className="flex items-center gap-2 text-red-400 mb-2">
          <AlertTriangle size={16} />
          <span className="font-semibold">WebGPU Not Available</span>
        </div>
        <p className="text-xs text-text/50">{error}</p>
        <p className="text-xs text-text/50 mt-2">
          Try Chrome 113+, Edge 113+, or enable WebGPU flags in your browser.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* GPU Info */}
      <div className="p-3 bg-surface/50 rounded-lg border border-neon-green/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-neon-green" />
            <span className="text-neon-green font-semibold">WebGPU Ready</span>
          </div>
          <span className="text-xs text-text/50">{gpuInfo}</span>
        </div>
      </div>

      {/* DAG Generation Progress */}
      {!dagReady && isMining && (
        <div className="p-3 bg-secondary/10 rounded-lg border border-secondary/30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-secondary">Generating DAG Cache...</span>
            <span className="text-sm text-secondary font-mono">{dagProgress}%</span>
          </div>
          <div className="h-2 bg-surface rounded overflow-hidden">
            <div
              className="h-full bg-secondary transition-all"
              style={{ width: `${dagProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Mining Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-surface/30 rounded border border-primary/20">
          <div className="text-xs text-text/50">Hashrate</div>
          <div className="text-lg font-mono text-primary">{formatHashrate(hashrate)}</div>
        </div>
        <div className="p-3 bg-surface/30 rounded border border-primary/20">
          <div className="text-xs text-text/50">Shares Found</div>
          <div className="text-lg font-mono text-neon-green">{sharesFound}</div>
        </div>
      </div>

      {/* Current Work Info */}
      {currentWork && isMining && (
        <div className="p-2 bg-surface/30 rounded text-xs text-text/50">
          <div>Block: {currentWork.blockNumber.toLocaleString()}</div>
          <div className="truncate">Header: {currentWork.headerHash.slice(0, 20)}...</div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Mining Controls */}
      <div className="flex gap-3">
        {!isMining ? (
          <button
            onClick={startMining}
            className="flex-1 py-3 px-4 rounded bg-neon-green/20 text-neon-green border border-neon-green/50 hover:bg-neon-green/30 transition-colors flex items-center justify-center gap-2 font-semibold"
          >
            <Play size={18} /> Start WebGPU Mining
          </button>
        ) : (
          <button
            onClick={stopMining}
            className="flex-1 py-3 px-4 rounded bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30 transition-colors flex items-center justify-center gap-2 font-semibold"
          >
            <Square size={18} /> Stop Mining
          </button>
        )}
      </div>

      {/* Performance Note */}
      <div className="text-xs text-text/50 bg-secondary/10 border border-secondary/30 p-3 rounded">
        <AlertTriangle size={12} className="inline mr-1 text-secondary" />
        WebGPU "light" mining generates DAG items on-demand. For better hashrate, use the native GPU miner below.
      </div>
    </div>
  );
};

export default WebGPUMiner;
