import * as schema from "./schema";

export class LeafClient {
  active: string | null = null;
  tabId: string | null = null;
  handler: (e: MessageEvent) => void = () => {};
  private sendQuery:
    | ((sql: string, requestId: string) => Promise<unknown>)
    | null = null;

  private genId() {
    return Math.random().toString(36).slice(2);
  }

  onMount() {
    if (!this.sendQuery) {
      this.sendQuery = window.__sendQuery;
    }
    this.tabId = window.__TAB_ID || null;
    this.active = window.__ACTIVE || null;
    this.handler = (e: MessageEvent) => {
      if (e?.data?.type === "ACTIVE_CHANGED") {
        this.active = e.data.activeTabId;
      }
    };
    window.addEventListener("message", this.handler);
  }

  onUnMount() {
    window.removeEventListener("message", this.handler);
  }

  async run(sql: string) {
    if (!this.sendQuery) {
      this.sendQuery = window.__sendQuery;
    }
    const id = this.genId();
    try {
      const res: Record<string, unknown> = (await this.sendQuery(
        sql,
        id,
      )) as Record<string, unknown>;
      if ("error" in res) {
        console.error(sql, res);
      } else {
        console.log(sql, res);
      }
      // const json = JSON.stringify(res, null, 2);
      return res;
    } catch (e) {
      return String(e);
    }
  }

  async initSchema() {
    await this.run(schema.pragmaLockingMode);
    await this.run(schema.pragmaWal);
    await this.run(schema.pragmaForeignKeys);

    await this.run(schema.createEntitiesTable);
    await this.run(schema.createEntitiesIndex);

    await this.run(schema.createEventsTable);
    await this.run(schema.createEventsIndex);
    await this.run(schema.createEventsIndexEntityCreated);

    await this.run(schema.createEdgesTable);
    await this.run(schema.createEdgesHeadIndex);
    await this.run(schema.createEdgesTailIndex);
    await this.run(schema.createEdgesHeadLabelIndex);
    await this.run(schema.createEdgesTailLabelIndex);

    await this.run(schema.createCompProfileTable);
    await this.run(schema.createCompProfileIndex);

    await this.run(schema.createCompConfigTable);
    await this.run(schema.createCompConfigIndex);

    await this.run(schema.createCompPageTable);

    await this.run(schema.createCompUploadTable);
    await this.run(schema.createCompUploadIndex);

    await this.run(schema.createCompUserAccessTimesTable);
    await this.run(schema.createCompUserAccessTimesCreatedIndex);
    await this.run(schema.createCompUserAccessTimesIndexUpdated);

    await this.run(schema.createCompTextContentTable);
    await this.run(schema.createCompTextContentIndex);
    await this.run(schema.createCompTextContentIndexFormat);

    await this.run(schema.createCompTextContentFtsTable);

    await this.run(schema.createCompNameTable);
    await this.run(schema.createCompNameIndex);

    await this.run(schema.createCompMediaTable);
    await this.run(schema.createCompMediaIndex);

    await this.run(schema.createCompIdentifierTable);
    await this.run(schema.createCompIdentifierIndex);

    await this.run(schema.createCompDescriptionTable);
    await this.run(schema.createCompDescriptionIndex);

    await this.run(schema.createCompUrlTable);
    await this.run(schema.createCompUrlIndex);

    return "Schema initialized";
  }
}
