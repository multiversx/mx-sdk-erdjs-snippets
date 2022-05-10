import path from "path";
import { existsSync, PathLike, readFileSync } from "fs";
import { Address } from "@elrondnetwork/erdjs";
import { ApiNetworkProvider, NetworkConfig, ProxyNetworkProvider } from "@elrondnetwork/erdjs-network-providers";
import { ErrBadSessionConfig } from "./errors";
import { IBunchOfUsers, IEventLog, INetworkProviderConfig, ISnapshottingService, IStorage, ITestSession, ITestSessionConfig, ITestUser, IToken } from "./interface";
import { INetworkConfig, INetworkProvider } from "./interfaceOfNetwork";
import { Storage } from "./storage/storage";
import { BunchOfUsers } from "./users";
import { resolvePath } from "./filesystem";
import { EventLog } from "./eventLog";
import { SnapshottingService } from "./snapshotting";
import { Report } from "./reports/report";

const TypeToken = "token";
const TypeAddress = "address";
const TypeArbitraryBreadcrumb = "breadcrumb";

export class TestSession implements ITestSession {
    readonly config: ITestSessionConfig;
    readonly name: string;
    readonly networkProvider: INetworkProvider;
    readonly users: IBunchOfUsers;
    readonly storage: IStorage;
    readonly snapshots: ISnapshottingService;
    readonly log: IEventLog;
    private networkConfig: INetworkConfig = new NetworkConfig();

    constructor(args: {
        config: ITestSessionConfig,
        name: string,
        provider: INetworkProvider,
        users: IBunchOfUsers,
        storage: IStorage,
        snapshots: ISnapshottingService,
        log: IEventLog
    }) {
        this.config = args.config;
        this.name = args.name;
        this.networkProvider = args.provider;
        this.users = args.users;
        this.storage = args.storage;
        this.snapshots = args.snapshots;
        this.log = args.log;
    }

    static async load(sessionName: string, folder: string): Promise<ITestSession> {
        const configFile = this.findSessionConfigFile(sessionName, folder);
        const folderOfConfigFile = path.dirname(configFile.toString());
        const configJson = readFileSync(configFile, { encoding: "utf8" });
        const config = <ITestSessionConfig>JSON.parse(configJson);

        const provider = this.createNetworkProvider(sessionName, config.networkProvider);
        const users = await BunchOfUsers.create(config.users);
        const storageName = resolvePath(folderOfConfigFile, `${sessionName}.session.sqlite`);
        const storage = await Storage.create(storageName.toString());
        const snapshots = new SnapshottingService(provider, storage);
        const log = new EventLog(storage);

        let session = new TestSession({
            config: config,
            name: sessionName,
            provider: provider,
            users: users,
            storage: storage,
            snapshots: snapshots,
            log: log
        });

        return session;
    }

    private static createNetworkProvider(sessionName: string, config: INetworkProviderConfig): INetworkProvider {
        if (!config.url) {
            throw new ErrBadSessionConfig(sessionName, "missing networkProvider.url");
        }
        if (!config.type) {
            throw new ErrBadSessionConfig(sessionName, "missing networkProvider.type");
        }

        if (config.type == ProxyNetworkProvider.name) {
            return new ProxyNetworkProvider(config.url, { timeout: config.timeout });
        }
        if (config.type == ApiNetworkProvider.name) {
            return new ApiNetworkProvider(config.url, { timeout: config.timeout });
        }

        throw new ErrBadSessionConfig(sessionName, "bad networkProvider.type");
    }

    private static findSessionConfigFile(sessionName: string, folder: string): PathLike {
        let configFile = resolvePath(folder, `${sessionName}.session.json`);
        if (existsSync(configFile)) {
            return configFile;
        }

        // Fallback to parent folder
        configFile = resolvePath(folder, "..", `${sessionName}.session.json`);
        if (existsSync(configFile)) {
            return configFile;
        }

        throw new ErrBadSessionConfig(sessionName, "file not found");
    }

    async syncNetworkConfig(): Promise<void> {
        this.networkConfig = await this.networkProvider.getNetworkConfig();
    }

    getNetworkConfig(): INetworkConfig {
        return this.networkConfig;
    }

    async syncUsers(users: ITestUser[]): Promise<void> {
        let promises = users.map(user => user.sync(this.networkProvider));
        await Promise.all(promises);
    }

    async saveAddress(name: string, address: Address): Promise<void> {
        console.log(`TestSession.saveAddress(): name = [${name}], address = ${address.bech32()}`);

        const breadcrumb = { type: TypeAddress, name: name, payload: address.bech32() };
        await this.storage.storeBreadcrumb(breadcrumb);
    }

    async loadAddress(name: string): Promise<Address> {
        const breadcrumb = await this.storage.loadBreadcrumb(name);
        const address = new Address(breadcrumb.payload);
        return address;
    }

    async saveToken(name: string, token: IToken): Promise<void> {
        console.log(`TestSession.saveToken(): name = [${name}], token = ${token.identifier}`);

        const breadcrumb = { type: TypeToken, name: name, payload: token };
        await this.storage.storeBreadcrumb(breadcrumb);
    }

    async loadToken(name: string): Promise<IToken> {
        const breadcrumb = await this.storage.loadBreadcrumb(name);
        const token = { identifier: breadcrumb.payload.identifier, decimals: breadcrumb.payload.decimals };
        return token;
    }

    async saveBreadcrumb(params: { type?: string, name: string, value: any }): Promise<void> {
        console.log(`TestSession.saveBreadcrumb(): name = [${params.name}], type = ${params.type}`);

        const breadcrumb = { type: params.type || TypeArbitraryBreadcrumb, name: params.name, payload: params.value };
        await this.storage.storeBreadcrumb(breadcrumb);
    }

    async loadBreadcrumb(name: string): Promise<any> {
        const breadcrumb = await this.storage.loadBreadcrumb(name);
        return breadcrumb.payload;
    }

    async loadBreadcrumbsByType(type: string): Promise<any[]> {
        const breadcrumbs = await this.storage.loadBreadcrumbsByType(type);
        const payloads = breadcrumbs.map(breadcrumb => breadcrumb.payload);
        return payloads;
    }

    async generateReport(tag?: string): Promise<void> {
        const report = new Report(this.config.reporting, this.storage);
        await report.prepare();
        await report.generate(tag);
    }

    async destroy(): Promise<void> {
        await this.storage.destroy();
    }
}
