// adderInteractor.ts
/**
 * The code in this file is partially usable as production code, as well.
 * Note: in production code, make sure you do not depend on {@link ITestUser}, {@link IEventLog} etc..
 * Note: in production code, make sure you DO NOT reference the package "erdjs-snippets".
 * Note: in dApps, make sure you use a proper wallet provider to sign the transaction.
 * @module
 */
import path from "path";
import { BigUIntValue, CodeMetadata, IAddress, Interaction, ResultsParser, ReturnCode, SmartContract, SmartContractAbi, TransactionWatcher } from "@elrondnetwork/erdjs";
import { IEventLog, ITestSession, ITestUser } from "../../interface";
import { loadAbiRegistry, loadCode } from "../../contracts";
import { INetworkConfig, INetworkProvider } from "../../interfaceOfNetwork";

const PathToWasm = path.resolve(__dirname, "adder.wasm");
const PathToAbi = path.resolve(__dirname, "adder.abi.json");

export async function createInteractor(session: ITestSession, contractAddress?: IAddress): Promise<AdderInteractor> {
    const registry = await loadAbiRegistry(PathToAbi);
    const abi = new SmartContractAbi(registry);
    const contract = new SmartContract({ address: contractAddress, abi: abi });
    const networkProvider = session.networkProvider;
    const networkConfig = session.getNetworkConfig();
    const log = session.log;
    const interactor = new AdderInteractor(contract, networkProvider, networkConfig, log);
    return interactor;
}

export class AdderInteractor {
    private readonly contract: SmartContract;
    private readonly networkProvider: INetworkProvider;
    private readonly networkConfig: INetworkConfig;
    private readonly transactionWatcher: TransactionWatcher;
    private readonly resultsParser: ResultsParser;
    private readonly log: IEventLog;

    constructor(contract: SmartContract, networkProvider: INetworkProvider, networkConfig: INetworkConfig, log: IEventLog) {
        this.contract = contract;
        this.networkProvider = networkProvider;
        this.networkConfig = networkConfig;
        this.transactionWatcher = new TransactionWatcher(networkProvider);
        this.resultsParser = new ResultsParser();
        this.log = log;
    }

    async deploy(deployer: ITestUser, initialValue: number): Promise<{ address: IAddress, returnCode: ReturnCode }> {
        // Load the bytecode.
        let code = await loadCode(PathToWasm);

        // Prepare the deploy transaction.
        let transaction = this.contract.deploy({
            code: code,
            codeMetadata: new CodeMetadata(),
            initArguments: [new BigUIntValue(initialValue)],
            gasLimit: 20000000,
            chainID: this.networkConfig.ChainID
        });

        // Set the transaction nonce. The account nonce must be synchronized beforehand.
        // Also, locally increment the nonce of the deployer (optional).
        transaction.setNonce(deployer.account.getNonceThenIncrement());

        // Let's sign the transaction. For dApps, use a wallet provider instead.
        await deployer.signer.sign(transaction);

        // The contract address is deterministically computable:
        const address = SmartContract.computeAddress(transaction.getSender(), transaction.getNonce());

        // Let's broadcast the transaction and await its completion:
        const transactionHash = await this.networkProvider.sendTransaction(transaction);
        await this.log.onContractDeploymentSent(transactionHash, address);
        
        let transactionOnNetwork = await this.transactionWatcher.awaitCompleted(transaction);
        await this.log.onTransactionCompleted(transactionHash, transactionOnNetwork);

        // In the end, parse the results:
        const { returnCode } = this.resultsParser.parseUntypedOutcome(transactionOnNetwork);

        console.log(`AdderInteractor.deploy(): contract = ${address}`);
        return { address, returnCode };
    }

    async add(caller: ITestUser, value: number): Promise<ReturnCode> {
        // Prepare the interaction
        let interaction = <Interaction>this.contract.methods
            .add([value])
            .withGasLimit(10000000)
            .withNonce(caller.account.getNonceThenIncrement())
            .withChainID(this.networkConfig.ChainID);

        // Let's check the interaction, then build the transaction object.
        let transaction = interaction.check().buildTransaction();

        // Let's sign the transaction. For dApps, use a wallet provider instead.
        await caller.signer.sign(transaction);

        // Let's broadcast the transaction and await its completion:
        const transactionHash = await this.networkProvider.sendTransaction(transaction);
        await this.log.onTransactionSent(transactionHash);

        let transactionOnNetwork = await this.transactionWatcher.awaitCompleted(transaction);
        await this.log.onTransactionCompleted(transactionHash, transactionOnNetwork);

        // In the end, parse the results:
        let { returnCode } = this.resultsParser.parseOutcome(transactionOnNetwork, interaction.getEndpoint());
        return returnCode;
    }

    async getSum(): Promise<number> {
        // Prepare the interaction, check it, then build the query:
        let interaction = <Interaction>this.contract.methods.getSum();
        let query = interaction.check().buildQuery();

        // Let's run the query and parse the results:
        let queryResponse = await this.networkProvider.queryContract(query);
        let { firstValue } = this.resultsParser.parseQueryResponse(queryResponse, interaction.getEndpoint());

        // Now let's interpret the results.
        let firstValueAsBigUInt = <BigUIntValue>firstValue;
        return firstValueAsBigUInt.valueOf().toNumber();
    }
}
