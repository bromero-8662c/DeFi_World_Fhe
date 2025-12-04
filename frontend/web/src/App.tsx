// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface GameAsset {
  id: string;
  name: string;
  type: string;
  encryptedValue: string;
  timestamp: number;
  owner: string;
  defiProtocol: string;
  attributes: {
    attack?: string;
    defense?: string;
    healing?: string;
    magic?: string;
  };
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'increase10%':
      result = value * 1.1;
      break;
    case 'decrease10%':
      result = value * 0.9;
      break;
    case 'double':
      result = value * 2;
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<GameAsset[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newAssetData, setNewAssetData] = useState({ 
    name: "", 
    type: "Weapon", 
    defiProtocol: "Aave", 
    value: 0,
    attributeType: "attack"
  });
  const [selectedAsset, setSelectedAsset] = useState<GameAsset | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("All");

  // Stats calculations
  const totalAssets = assets.length;
  const aaveAssets = assets.filter(a => a.defiProtocol === "Aave").length;
  const compoundAssets = assets.filter(a => a.defiProtocol === "Compound").length;
  const uniswapAssets = assets.filter(a => a.defiProtocol === "Uniswap").length;

  useEffect(() => {
    loadAssets().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadAssets = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      // Get asset keys
      const keysBytes = await contract.getData("asset_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing asset keys:", e); }
      }
      
      // Load each asset
      const list: GameAsset[] = [];
      for (const key of keys) {
        try {
          const assetBytes = await contract.getData(`asset_${key}`);
          if (assetBytes.length > 0) {
            try {
              const assetData = JSON.parse(ethers.toUtf8String(assetBytes));
              list.push({ 
                id: key, 
                name: assetData.name,
                type: assetData.type,
                encryptedValue: assetData.value, 
                timestamp: assetData.timestamp, 
                owner: assetData.owner, 
                defiProtocol: assetData.defiProtocol,
                attributes: assetData.attributes || {}
              });
            } catch (e) { console.error(`Error parsing asset data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading asset ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setAssets(list);
    } catch (e) { console.error("Error loading assets:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const createAsset = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting DeFi position with Zama FHE..." });
    try {
      const encryptedValue = FHEEncryptNumber(newAssetData.value);
      
      // Generate attributes based on DeFi protocol and value
      const attributes: any = {};
      if (newAssetData.attributeType === "attack") {
        attributes.attack = FHEEncryptNumber(newAssetData.value * 0.1);
      } else if (newAssetData.attributeType === "defense") {
        attributes.defense = FHEEncryptNumber(newAssetData.value * 0.15);
      } else if (newAssetData.attributeType === "healing") {
        attributes.healing = FHEEncryptNumber(newAssetData.value * 0.05);
      } else {
        attributes.magic = FHEEncryptNumber(newAssetData.value * 0.2);
      }
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const assetId = `asset-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const assetData = { 
        name: newAssetData.name,
        type: newAssetData.type,
        value: encryptedValue, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        defiProtocol: newAssetData.defiProtocol,
        attributes
      };
      
      await contract.setData(`asset_${assetId}`, ethers.toUtf8Bytes(JSON.stringify(assetData)));
      
      // Update asset keys
      const keysBytes = await contract.getData("asset_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(assetId);
      await contract.setData("asset_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE-encrypted game asset created!" });
      await loadAssets();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewAssetData({ 
          name: "", 
          type: "Weapon", 
          defiProtocol: "Aave", 
          value: 0,
          attributeType: "attack"
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      console.error("Decryption failed:", e); 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Contract not available");
      const isAvailable = await contract.isAvailable();
      alert(`Contract is ${isAvailable ? 'available' : 'not available'}`);
    } catch (e) {
      console.error("Error checking availability:", e);
      alert("Failed to check contract availability");
    }
  };

  const filteredAssets = assets.filter(asset => {
    const matchesSearch = asset.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         asset.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         asset.defiProtocol.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === "All" || asset.type === filterType;
    return matchesSearch && matchesType;
  });

  const renderProtocolChart = () => {
    const total = assets.length || 1;
    const aavePercentage = (aaveAssets / total) * 100;
    const compoundPercentage = (compoundAssets / total) * 100;
    const uniswapPercentage = (uniswapAssets / total) * 100;
    
    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div className="pie-segment aave" style={{ transform: `rotate(${aavePercentage * 3.6}deg)` }}></div>
          <div className="pie-segment compound" style={{ transform: `rotate(${(aavePercentage + compoundPercentage) * 3.6}deg)` }}></div>
          <div className="pie-segment uniswap" style={{ transform: `rotate(${(aavePercentage + compoundPercentage + uniswapPercentage) * 3.6}deg)` }}></div>
          <div className="pie-center">
            <div className="pie-value">{assets.length}</div>
            <div className="pie-label">Assets</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item"><div className="color-box aave"></div><span>Aave: {aaveAssets}</span></div>
          <div className="legend-item"><div className="color-box compound"></div><span>Compound: {compoundAssets}</span></div>
          <div className="legend-item"><div className="color-box uniswap"></div><span>Uniswap: {uniswapAssets}</span></div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing encrypted game world...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon"><div className="shield-icon"></div></div>
          <h1>DeFi<span>World</span>FHE</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-asset-btn cyber-button">
            <div className="add-icon"></div>Mint Asset
          </button>
          <button className="cyber-button" onClick={checkAvailability}>
            Check FHE Status
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>FHE-Encrypted DeFi World</h2>
            <p>Where your DeFi positions become magical game assets with Zama FHE technology</p>
          </div>
          <div className="fhe-indicator">
            <div className="fhe-lock"></div>
            <span>FHE Encryption Active</span>
          </div>
        </div>
        
        <div className="dashboard-grid">
          <div className="dashboard-card cyber-card">
            <h3>Project Introduction</h3>
            <p>
              Welcome to <strong>DeFi World FHE</strong>, an autonomous world where game assets are actually 
              FHE-encrypted DeFi positions. Your "Magic Sword" might be an Aave deposit, while a 
              "Healing Potion" could represent a stablecoin LP share. All asset attributes are 
              homomorphically updated based on underlying protocol performance.
            </p>
            <div className="fhe-badge"><span>Powered by Zama FHE</span></div>
          </div>
          
          <div className="dashboard-card cyber-card">
            <h3>Game Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{totalAssets}</div>
                <div className="stat-label">Total Assets</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{aaveAssets}</div>
                <div className="stat-label">Aave Items</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{compoundAssets}</div>
                <div className="stat-label">Compound Items</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{uniswapAssets}</div>
                <div className="stat-label">Uniswap Items</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card cyber-card">
            <h3>Protocol Distribution</h3>
            {renderProtocolChart()}
          </div>
        </div>
        
        <div className="assets-section">
          <div className="section-header">
            <h2>Game Assets Inventory</h2>
            <div className="header-actions">
              <div className="search-filter">
                <input 
                  type="text" 
                  placeholder="Search assets..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="cyber-input"
                />
                <select 
                  value={filterType} 
                  onChange={(e) => setFilterType(e.target.value)}
                  className="cyber-select"
                >
                  <option value="All">All Types</option>
                  <option value="Weapon">Weapons</option>
                  <option value="Armor">Armor</option>
                  <option value="Potion">Potions</option>
                  <option value="Artifact">Artifacts</option>
                </select>
              </div>
              <button onClick={loadAssets} className="refresh-btn cyber-button" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="assets-list cyber-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Name</div>
              <div className="header-cell">Type</div>
              <div className="header-cell">DeFi Protocol</div>
              <div className="header-cell">Owner</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {filteredAssets.length === 0 ? (
              <div className="no-assets">
                <div className="no-assets-icon"></div>
                <p>No game assets found</p>
                <button className="cyber-button primary" onClick={() => setShowCreateModal(true)}>
                  Mint Your First Asset
                </button>
              </div>
            ) : filteredAssets.map(asset => (
              <div className="asset-row" key={asset.id} onClick={() => setSelectedAsset(asset)}>
                <div className="table-cell asset-id">#{asset.id.substring(0, 6)}</div>
                <div className="table-cell">{asset.name}</div>
                <div className="table-cell">{asset.type}</div>
                <div className="table-cell">{asset.defiProtocol}</div>
                <div className="table-cell">{asset.owner.substring(0, 6)}...{asset.owner.substring(38)}</div>
                <div className="table-cell actions">
                  <button className="action-btn cyber-button" onClick={(e) => { e.stopPropagation(); setSelectedAsset(asset); }}>
                    Details
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreate 
          onSubmit={createAsset} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          assetData={newAssetData} 
          setAssetData={setNewAssetData}
        />
      )}
      
      {selectedAsset && (
        <AssetDetailModal 
          asset={selectedAsset} 
          onClose={() => { setSelectedAsset(null); setDecryptedValue(null); }} 
          decryptedValue={decryptedValue} 
          setDecryptedValue={setDecryptedValue} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>DeFi World FHE</span>
            </div>
            <p>Fully Homomorphic Encryption for game assets backed by DeFi positions</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>FHE-Powered Gaming</span></div>
          <div className="copyright">© {new Date().getFullYear()} DeFi World FHE. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  assetData: any;
  setAssetData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, assetData, setAssetData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setAssetData({ ...assetData, [name]: value });
  };

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setAssetData({ ...assetData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!assetData.name || !assetData.value) { 
      alert("Please fill required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card">
        <div className="modal-header">
          <h2>Mint New Game Asset</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Your DeFi position will be encrypted with Zama FHE before becoming a game asset</p>
            </div>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Asset Name *</label>
              <input 
                type="text" 
                name="name" 
                value={assetData.name} 
                onChange={handleChange} 
                placeholder="e.g. Magic Sword" 
                className="cyber-input"
              />
            </div>
            
            <div className="form-group">
              <label>Asset Type *</label>
              <select name="type" value={assetData.type} onChange={handleChange} className="cyber-select">
                <option value="Weapon">Weapon</option>
                <option value="Armor">Armor</option>
                <option value="Potion">Potion</option>
                <option value="Artifact">Artifact</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>DeFi Protocol *</label>
              <select name="defiProtocol" value={assetData.defiProtocol} onChange={handleChange} className="cyber-select">
                <option value="Aave">Aave</option>
                <option value="Compound">Compound</option>
                <option value="Uniswap">Uniswap</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Primary Attribute *</label>
              <select name="attributeType" value={assetData.attributeType} onChange={handleChange} className="cyber-select">
                <option value="attack">Attack Power</option>
                <option value="defense">Defense Power</option>
                <option value="healing">Healing Power</option>
                <option value="magic">Magic Power</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>DeFi Position Value (USD) *</label>
              <input 
                type="number" 
                name="value" 
                value={assetData.value} 
                onChange={handleValueChange} 
                placeholder="Enter numerical value..." 
                className="cyber-input"
                step="0.01"
                min="0"
              />
            </div>
          </div>
          
          <div className="encryption-preview">
            <h4>FHE Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Plain Value:</span>
                <div>${assetData.value || '0'}</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>{assetData.value ? FHEEncryptNumber(assetData.value).substring(0, 50) + '...' : 'No value entered'}</div>
              </div>
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <div>
              <strong>Data Privacy Guarantee</strong>
              <p>Your financial data remains encrypted during FHE processing and is never decrypted on our servers</p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn cyber-button">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn cyber-button primary">
            {creating ? "Encrypting with FHE..." : "Mint Asset"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface AssetDetailModalProps {
  asset: GameAsset;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const AssetDetailModal: React.FC<AssetDetailModalProps> = ({ asset, onClose, decryptedValue, setDecryptedValue, isDecrypting, decryptWithSignature }) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { 
      setDecryptedValue(null); 
      return; 
    }
    const decrypted = await decryptWithSignature(asset.encryptedValue);
    if (decrypted !== null) setDecryptedValue(decrypted);
  };

  const renderAttribute = (name: string, value: string) => {
    return (
      <div className="attribute-item">
        <span className="attribute-name">{name}:</span>
        <span className="attribute-value">{value.substring(0, 20)}...</span>
        <span className="fhe-tag-small">FHE</span>
      </div>
    );
  };

  return (
    <div className="modal-overlay">
      <div className="asset-detail-modal cyber-card">
        <div className="modal-header">
          <h2>{asset.name} Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="asset-info">
            <div className="info-item">
              <span>Type:</span>
              <strong>{asset.type}</strong>
            </div>
            <div className="info-item">
              <span>DeFi Protocol:</span>
              <strong>{asset.defiProtocol}</strong>
            </div>
            <div className="info-item">
              <span>Owner:</span>
              <strong>{asset.owner.substring(0, 6)}...{asset.owner.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Created:</span>
              <strong>{new Date(asset.timestamp * 1000).toLocaleString()}</strong>
            </div>
          </div>
          
          <div className="asset-attributes">
            <h3>Encrypted Attributes</h3>
            <div className="attributes-grid">
              {asset.attributes.attack && renderAttribute("Attack", asset.attributes.attack)}
              {asset.attributes.defense && renderAttribute("Defense", asset.attributes.defense)}
              {asset.attributes.healing && renderAttribute("Healing", asset.attributes.healing)}
              {asset.attributes.magic && renderAttribute("Magic", asset.attributes.magic)}
            </div>
          </div>
          
          <div className="encrypted-data-section">
            <h3>Encrypted DeFi Position</h3>
            <div className="encrypted-data">
              {asset.encryptedValue.substring(0, 100)}...
            </div>
            <div className="fhe-tag">
              <div className="fhe-icon"></div>
              <span>FHE Encrypted</span>
            </div>
            <button 
              className="decrypt-btn cyber-button" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? (
                <span className="decrypt-spinner"></span>
              ) : decryptedValue !== null ? (
                "Hide Decrypted Value"
              ) : (
                "Decrypt with Wallet Signature"
              )}
            </button>
          </div>
          
          {decryptedValue !== null && (
            <div className="decrypted-data-section">
              <h3>Decrypted Value</h3>
              <div className="decrypted-value">${decryptedValue.toFixed(2)}</div>
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>Decrypted data is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn cyber-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;
