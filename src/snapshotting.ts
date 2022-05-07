import { IAddress, IStorage } from "./interface";
import { INetworkProvider } from "./interfaceOfNetwork";

export class SnapshottingService {
    private readonly scope: string;
    private readonly networkProvider: INetworkProvider;
    private readonly storage: IStorage;

    constructor(scope: string, networkProvider: INetworkProvider, storage: IStorage) {
        this.scope = scope;
        this.networkProvider = networkProvider;
        this.storage = storage;
    }

    async takeSnapshotsOfAccount(address: IAddress): Promise<void> {
        const account = await this.networkProvider.getAccount(address);
        const fungibleTokens = await this.networkProvider.getFungibleTokensOfAccount(address);
        const nonFungibleTokens = await this.networkProvider.getNonFungibleTokensOfAccount(address);

        const simplifiedFungibleTokens: any[] = fungibleTokens.map(token => {
            return {
                identifier: token.identifier,
                balance: token.balance.toString()
            }
        });

        const simplifiedNonFungibleTokens: any[] = nonFungibleTokens.map(token => {
            return {
                identifier: token.identifier,
                nonce: token.nonce
            }
        });

        const snapshot = {
            address: address,
            nonce: account.nonce,
            balance: account.balance,
            fungibleTokens: simplifiedFungibleTokens,
            nonFungibleTokens: simplifiedNonFungibleTokens
        };

        await this.storage.storeAccountSnapshot(this.scope, snapshot);
    }
}
