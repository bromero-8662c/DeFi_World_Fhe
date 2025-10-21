pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DeFiWorldFhe is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchNotOpen();
    error BatchAlreadyClosed();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidBatchId();

    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event PausedSet(bool paused);
    event CooldownSet(uint256 cooldownSeconds);
    event BatchOpened(uint256 batchId);
    event BatchClosed(uint256 batchId);
    event AssetSubmitted(address indexed provider, uint256 indexed batchId, uint256 assetId);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256[] cleartextValues);

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    struct Asset {
        euint32 baseValueEncrypted;
        euint32 yieldMultiplierEncrypted;
        euint32 riskFactorEncrypted;
    }

    struct Batch {
        bool isOpen;
        uint256 totalAssets;
    }

    mapping(uint256 => Asset) public encryptedAssets;
    mapping(uint256 => Batch) public batches;
    mapping(uint256 => DecryptionContext) public decryptionContexts;
    mapping(address => bool) public isProvider;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    address public owner;
    bool public paused;
    uint256 public cooldownSeconds;
    uint256 public currentBatchId;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier submissionCooldown(address submitter) {
        if (block.timestamp < lastSubmissionTime[submitter] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier decryptionCooldown(address requester) {
        if (block.timestamp < lastDecryptionRequestTime[requester] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        paused = false;
        cooldownSeconds = 60;
        currentBatchId = 0;
    }

    function addProvider(address provider) external onlyOwner {
        isProvider[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        isProvider[provider] = false;
        emit ProviderRemoved(provider);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSet(newCooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        batches[currentBatchId] = Batch({isOpen: true, totalAssets: 0});
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (currentBatchId == 0 || !batches[currentBatchId].isOpen) {
            revert BatchNotOpen();
        }
        batches[currentBatchId].isOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitAsset(
        uint256 batchId,
        euint32 baseValueEncrypted,
        euint32 yieldMultiplierEncrypted,
        euint32 riskFactorEncrypted
    ) external onlyProvider whenNotPaused submissionCooldown(msg.sender) {
        if (batchId == 0 || batchId > currentBatchId || !batches[batchId].isOpen) {
            revert BatchNotOpen();
        }

        uint256 assetId = batches[batchId].totalAssets + 1;
        encryptedAssets[assetId] = Asset({
            baseValueEncrypted: baseValueEncrypted,
            yieldMultiplierEncrypted: yieldMultiplierEncrypted,
            riskFactorEncrypted: riskFactorEncrypted
        });
        batches[batchId].totalAssets = assetId;
        lastSubmissionTime[msg.sender] = block.timestamp;
        emit AssetSubmitted(msg.sender, batchId, assetId);
    }

    function requestBatchDecryption(uint256 batchId) external onlyOwner whenNotPaused decryptionCooldown(msg.sender) {
        if (batchId == 0 || batchId > currentBatchId || batches[batchId].isOpen) {
            revert BatchNotOpen();
        }
        if (batches[batchId].totalAssets == 0) {
            revert InvalidBatchId();
        }

        bytes32[] memory cts = new bytes32[](3);
        uint256 totalAssets = batches[batchId].totalAssets;
        euint32 memory totalBaseValueEncrypted = FHE.asEuint32(0);
        euint32 memory totalYieldMultiplierEncrypted = FHE.asEuint32(0);
        euint32 memory totalRiskFactorEncrypted = FHE.asEuint32(0);

        for (uint256 i = 1; i <= totalAssets; i++) {
            Asset storage asset = encryptedAssets[i];
            totalBaseValueEncrypted = FHE.add(totalBaseValueEncrypted, asset.baseValueEncrypted);
            totalYieldMultiplierEncrypted = FHE.add(totalYieldMultiplierEncrypted, asset.yieldMultiplierEncrypted);
            totalRiskFactorEncrypted = FHE.add(totalRiskFactorEncrypted, asset.riskFactorEncrypted);
        }

        cts[0] = FHE.toBytes32(totalBaseValueEncrypted);
        cts[1] = FHE.toBytes32(totalYieldMultiplierEncrypted);
        cts[2] = FHE.toBytes32(totalRiskFactorEncrypted);

        bytes32 stateHash = keccak256(abi.encode(cts, address(this)));
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: batchId,
            stateHash: stateHash,
            processed: false
        });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) {
            revert ReplayAttempt();
        }

        uint256 batchId = decryptionContexts[requestId].batchId;
        uint256 totalAssets = batches[batchId].totalAssets;

        euint32 memory totalBaseValueEncrypted = FHE.asEuint32(0);
        euint32 memory totalYieldMultiplierEncrypted = FHE.asEuint32(0);
        euint32 memory totalRiskFactorEncrypted = FHE.asEuint32(0);

        for (uint256 i = 1; i <= totalAssets; i++) {
            Asset storage asset = encryptedAssets[i];
            totalBaseValueEncrypted = FHE.add(totalBaseValueEncrypted, asset.baseValueEncrypted);
            totalYieldMultiplierEncrypted = FHE.add(totalYieldMultiplierEncrypted, asset.yieldMultiplierEncrypted);
            totalRiskFactorEncrypted = FHE.add(totalRiskFactorEncrypted, asset.riskFactorEncrypted);
        }

        bytes32[] memory cts = new bytes32[](3);
        cts[0] = FHE.toBytes32(totalBaseValueEncrypted);
        cts[1] = FHE.toBytes32(totalYieldMultiplierEncrypted);
        cts[2] = FHE.toBytes32(totalRiskFactorEncrypted);

        bytes32 currentHash = keccak256(abi.encode(cts, address(this)));
        if (currentHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatch();
        }

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint256[] memory cleartextValues = new uint256[](3);
        assembly {
            cleartextValues[0] := mload(add(cleartexts, 0x20))
            cleartextValues[1] := mload(add(cleartexts, 0x40))
            cleartextValues[2] := mload(add(cleartexts, 0x60))
        }

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, batchId, cleartextValues);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 storage cipher) internal {
        if (!FHE.isInitialized(cipher)) {
            cipher = FHE.asEuint32(0);
        }
    }

    function _requireInitialized(euint32 storage cipher) internal view {
        if (!FHE.isInitialized(cipher)) {
            revert("Cipher not initialized");
        }
    }
}