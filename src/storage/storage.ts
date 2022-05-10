import * as fs from "fs";
import * as sql from "./sql";
import DatabaseConstructor, { Database } from "better-sqlite3";
import { IAccountSnapshotTowardsStorage, IBreadcrumbFromStorage, IBreadcrumbTowardsStorage, IEventTowardsStorage, IInteractionTowardsStorage, IStorage } from "../interface";

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

    async storeBreadcrumb(scope: string, breadcrumb: IBreadcrumbTowardsStorage): Promise<void> {
        const serializedPayload = this.serializeItem(breadcrumb.payload);
        const find = this.db.prepare(sql.Breadcrumb.GetByScopeAndName);
        const insert = this.db.prepare(sql.Breadcrumb.Insert);
        const update = this.db.prepare(sql.Breadcrumb.UpdateSetPayload);
        const existingRecord = find.get({ scope: scope, name: breadcrumb.name });

        if (existingRecord) {
            update.run({
                id: existingRecord.id,
                payload: serializedPayload
            });

            return;
        }

        insert.run({
            scope: scope,
            type: breadcrumb.type,
            name: breadcrumb.name,
            payload: serializedPayload
        });
    }

    async loadBreadcrumb(scope: string, name: string): Promise<IBreadcrumbFromStorage> {
        const find = this.db.prepare(sql.Breadcrumb.GetByScopeAndName);
        const row = find.get({ scope: scope, name: name });
        const result = {
            name: row.name,
            type: row.type,
            payload: this.deserializeItem(row.payload)
        };

        return result;
    }

    async loadBreadcrumbs(scope: string): Promise<IBreadcrumbFromStorage[]> {
        const find = this.db.prepare(sql.Breadcrumb.GetAll);
        const rows = find.all({ scope: scope });
        const results = rows.map(row => {
            return {
                name: row.name,
                type: row.type,
                payload: this.deserializeItem(row.payload)
            }
        });

        return results;
    }

    async loadBreadcrumbsByType(scope: string, type: string): Promise<IBreadcrumbFromStorage[]> {
        const find = this.db.prepare(sql.Breadcrumb.GetByScopeAndType);
        const rows = find.all({ scope: scope, type: type });
        const results = rows.map(row => {
            return {
                name: row.name,
                type: row.type,
                payload: this.deserializeItem(row.payload)
            }
        });

        return results;
    }

    async storeInteraction(scope: string, interaction: IInteractionTowardsStorage): Promise<number> {
        const record = {
            scope: scope,
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
        const result = insert.run(record);
        const id = Number(result.lastInsertRowid);
        return id;
    }

    async updateInteractionSetOutput(id: number, output: any) {
        const outputJson = JSON.stringify(output);
        const update = this.db.prepare(sql.Interaction.UpdateSetOutput);
        update.run({ id: id, output: outputJson });
    }

    async storeAccountSnapshot(scope: string, snapshot: IAccountSnapshotTowardsStorage): Promise<void> {
        const record: any = {
            scope: scope,
            address: snapshot.address.bech32(),
            nonce: snapshot.nonce.valueOf(),
            balance: snapshot.balance.toString(),
            fungibleTokens: this.serializeItem(snapshot.fungibleTokens || []),
            nonFungibleTokens: this.serializeItem(snapshot.nonFungibleTokens || []),
            takenBeforeInteraction: snapshot.takenBeforeInteraction || null,
            takenAfterInteraction: snapshot.takenAfterInteraction || null
        }

        const insert = this.db.prepare(sql.AccountSnapshot.Insert);
        insert.run(record);
    }

    async logEvent(scope: string, event: IEventTowardsStorage): Promise<void> {
        const record: any = {
            scope: scope,
            event: event.kind,
            summary: event.summary,
            payload: this.serializeItem(event.payload),
            interaction: event.interaction
        }

        const insert = this.db.prepare(sql.Log.Insert);
        insert.run(record);
    }

    private serializeItem(item: any) {
        return JSON.stringify(item || {}, null, 4);
    }

    private deserializeItem(json: string) {
        return JSON.parse(json);
    }
}
