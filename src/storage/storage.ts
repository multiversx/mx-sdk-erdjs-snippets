import * as fs from "fs";
import * as sql from "./sql";
import DatabaseConstructor, { Database } from "better-sqlite3";
import { IAccountSnapshotRecord, IBreadcrumbRecord, IEventRecord, IInteractionRecord, IStorage } from "../interface";
import { ErrBreadcrumbNotFound } from "../errors";

export class Storage implements IStorage {
    private readonly file: string;
    private readonly db: Database;

    constructor(file: string, connection: Database) {
        this.file = file;
        this.db = connection;
    }

    static async create(file: string): Promise<Storage> {
        let shouldCreateSchema = !fs.existsSync(file);
        let db = new DatabaseConstructor(file, {});

        if (shouldCreateSchema) {
            db.prepare(sql.Breadcrumb.CreateTable).run();
            db.prepare(sql.Interaction.CreateTable).run();
            db.prepare(sql.AccountSnapshot.CreateTable).run();
            db.prepare(sql.Log.CreateTable).run();
        }

        return new Storage(file, db);
    }

    async destroy() {
        this.db.close();
        await fs.promises.unlink(this.file);
    }

    async storeBreadcrumb(breadcrumb: IBreadcrumbRecord): Promise<void> {
        const serializedPayload = this.serializeItem(breadcrumb.payload);
        const find = this.db.prepare(sql.Breadcrumb.GetByName);
        const insert = this.db.prepare(sql.Breadcrumb.Insert);
        const delete_ = this.db.prepare(sql.Breadcrumb.Delete);
        const existingRow = find.get({ name: breadcrumb.name });

        if (existingRow) {
            delete_.run({ id: existingRow.id });
        }

        insert.run({
            correlationTag: breadcrumb.correlationTag,
            type: breadcrumb.type,
            name: breadcrumb.name,
            payload: serializedPayload
        });
    }

    async loadBreadcrumb(name: string): Promise<IBreadcrumbRecord> {
        const find = this.db.prepare(sql.Breadcrumb.GetByName);
        const row = find.get({ name: name });

        if (!row) {
            throw new ErrBreadcrumbNotFound(name);
        }

        const record = this.hydrateBreadcrumb(row);
        return record;
    }

    private hydrateBreadcrumb(row: any): IBreadcrumbRecord {
        return {
            id: row.id,
            correlationTag: row.correlation_tag,
            name: row.name,
            type: row.type,
            payload: this.deserializeItem(row.payload)
        };
    }

    async loadBreadcrumbs(): Promise<IBreadcrumbRecord[]> {
        const find = this.db.prepare(sql.Breadcrumb.GetAll);
        const rows = find.all();
        const records = rows.map(row => this.hydrateBreadcrumb(row));
        return records;
    }

    async loadBreadcrumbsByType(type: string): Promise<IBreadcrumbRecord[]> {
        const find = this.db.prepare(sql.Breadcrumb.GetByType);
        const rows = find.all({ type: type });
        const records = rows.map(row => this.hydrateBreadcrumb(row));
        return records;
    }

    async storeInteraction(interaction: IInteractionRecord): Promise<number> {
        const row = {
            correlationTag: interaction.correlationTag,
            action: interaction.action,
            user: interaction.userAddress.bech32(),
            contract: interaction.contractAddress.bech32(),
            transaction: interaction.transactionHash.toString(),
            timestamp: interaction.timestamp,
            round: interaction.round,
            epoch: interaction.epoch,
            blockNonce: interaction.blockNonce.valueOf(),
            hyperblockNonce: interaction.hyperblockNonce.valueOf(),
            input: this.serializeItem(interaction.input),
            transfers: this.serializeItem(interaction.transfers),
            output: this.serializeItem(interaction.output),
        };

        const insert = this.db.prepare(sql.Interaction.Insert);
        const result = insert.run(row);
        const id = Number(result.lastInsertRowid);
        return id;
    }

    async updateInteractionSetOutput(id: number, output: any) {
        const outputJson = JSON.stringify(output);
        const update = this.db.prepare(sql.Interaction.UpdateSetOutput);
        update.run({ id: id, output: outputJson });
    }

    loadInteractions(): Promise<IInteractionRecord[]> {
        throw new Error("Method not implemented.");
    }

    async storeAccountSnapshot(snapshot: IAccountSnapshotRecord): Promise<void> {
        const row: any = {
            correlationTag: snapshot.correlationTag,
            address: snapshot.address.bech32(),
            nonce: snapshot.nonce.valueOf(),
            balance: snapshot.balance.toString(),
            fungibleTokens: this.serializeItem(snapshot.fungibleTokens || []),
            nonFungibleTokens: this.serializeItem(snapshot.nonFungibleTokens || []),
            takenBeforeInteraction: snapshot.takenBeforeInteraction || null,
            takenAfterInteraction: snapshot.takenAfterInteraction || null
        }

        const insert = this.db.prepare(sql.AccountSnapshot.Insert);
        insert.run(row);
    }

    loadAccountSnapshots(): Promise<IAccountSnapshotRecord[]> {
        throw new Error("Method not implemented.");
    }

    async logEvent(event: IEventRecord): Promise<void> {
        const row: any = {
            correlationTag: event.correlationTag,
            event: event.kind,
            summary: event.summary,
            payload: this.serializeItem(event.payload),
            interaction: event.interaction
        }

        const insert = this.db.prepare(sql.Log.Insert);
        insert.run(row);
    }

    loadEvents(): Promise<IEventRecord[]> {
        throw new Error("Method not implemented.");
    }

    private serializeItem(item: any) {
        return JSON.stringify(item || {}, null, 4);
    }

    private deserializeItem(json: string) {
        return JSON.parse(json);
    }
}
