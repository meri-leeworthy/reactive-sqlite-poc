// Having each SQL statement in a separate const is helpful for debugging and introspection

export const pragmaLockingMode = `PRAGMA locking_mode=exclusive;`;
export const pragmaWal = `PRAGMA journal_mode = WAL;`;
export const pragmaForeignKeys = `PRAGMA foreign_keys = ON;`;

export const createEntitiesTable = `
CREATE TABLE IF NOT EXISTS entities (
  ulid BLOB PRIMARY KEY, 
  type TEXT, 
  created_at INTEGER
) STRICT;`;
export const createEntitiesIndex = `CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);`;

export const createEventsTable = `CREATE TABLE IF NOT EXISTS events (
  event_ulid BLOB PRIMARY KEY,
  entity_ulid BLOB REFERENCES entities(ulid) ON DELETE CASCADE,
  payload BLOB,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
) STRICT;`;
export const createEventsIndex = `CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);`;
export const createEventsIndexEntityCreated = `CREATE INDEX IF NOT EXISTS idx_events_entity_created ON events(entity_id, created_at, event_ulid);`;

export const createEdgesTable = `
CREATE TABLE IF NOT EXISTS edges (
    head BLOB NOT NULL,
    tail BLOB NOT NULL,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    PRIMARY KEY (head, tail, kind),
    FOREIGN KEY (head) REFERENCES entities(ulid) ON DELETE CASCADE,
    FOREIGN KEY (tail) REFERENCES entities(ulid) ON DELETE CASCADE
) STRICT;
`;

export const createEdgesHeadIndex = `CREATE INDEX IF NOT EXISTS idx_edges_head ON edges(head);`;
export const createEdgesTailIndex = `CREATE INDEX IF NOT EXISTS idx_edges_tail ON edges(tail);`;
export const createEdgesHeadKindIndex = `CREATE INDEX IF NOT EXISTS idx_edges_head_kind ON edges(head, kind);`;
export const createEdgesTailKindIndex = `CREATE INDEX IF NOT EXISTS idx_edges_tail_kind ON edges(tail, kind);`;

export const createCompProfileTable = `
CREATE TABLE IF NOT EXISTS comp_profile (
    entity TEXT PRIMARY KEY REFERENCES entities(ulid) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    blueskyHandle TEXT,
    bannerUrl TEXT,
    joinedDate INTEGER
) STRICT;
`;
export const createCompProfileIndex = `CREATE INDEX IF NOT EXISTS idx_profile_handle ON comp_profile(blueskyHandle);`;

export const createCompConfigTable = `
CREATE TABLE IF NOT EXISTS comp_config (
    entity TEXT PRIMARY KEY REFERENCES entities(ulid) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    config TEXT CHECK (json_valid(config))
) STRICT;
`;
export const createCompConfigIndex = `CREATE INDEX IF NOT EXISTS idx_config_config ON comp_config(config);`;

export const createCompPageTable = `
CREATE TABLE IF NOT EXISTS comp_page (
    entity TEXT PRIMARY KEY REFERENCES entities(ulid) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;
`;

export const createCompUploadMediaTable = `
CREATE TABLE IF NOT EXISTS comp_upload_media (
    entity TEXT PRIMARY KEY REFERENCES entities(ulid) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    media_type TEXT CHECK(media_type IN ('image','video')),
    status TEXT CHECK(status IN ('pending','processing','completed','failed')),
    url TEXT,
    attach_to_message_id BLOB REFERENCES entities(ulid)
) STRICT;
`;
export const createCompUploadMediaIndex = `CREATE INDEX IF NOT EXISTS idx_upload_media_status ON comp_upload_media(status);`;
export const createCompUploadMediaIndexAttach = `CREATE INDEX IF NOT EXISTS idx_upload_media_attach ON comp_upload_media(attach_to_message_id);`;

export const createCompUserAccessTimesTable = `
CREATE TABLE IF NOT EXISTS comp_user_access_times (
    entity TEXT PRIMARY KEY REFERENCES entities(ulid) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;
`;
export const createCompUserAccessTimesCreatedIndex = `CREATE INDEX IF NOT EXISTS idx_user_access_times ON comp_user_access_times(created_at);`;
export const createCompUserAccessTimesIndexUpdated = `CREATE INDEX IF NOT EXISTS idx_user_access_times_updated ON comp_user_access_times(updated_at);`;

export const createCompTextContentTable = `
CREATE TABLE IF NOT EXISTS comp_text_content (
    entity TEXT PRIMARY KEY REFERENCES entities(ulid) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    text TEXT,
    format TEXT
) STRICT;
`;
export const createCompTextContentIndex = `CREATE INDEX IF NOT EXISTS idx_text_content_text ON comp_text_content(text);`;
export const createCompTextContentIndexFormat = `CREATE INDEX IF NOT EXISTS idx_text_content_format ON comp_text_content(format);`;

export const createCompTextContentFtsTable = `
CREATE VIRTUAL TABLE IF NOT EXISTS comp_text_content_fts USING fts5(
    text, format, content='comp_text_content', content_rowid='rowid'
);
`;

export const createCompNameTable = `
CREATE TABLE IF NOT EXISTS comp_name (
    entity TEXT PRIMARY KEY REFERENCES entities(ulid) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    name TEXT
) STRICT;
`;
export const createCompNameIndex = `CREATE INDEX IF NOT EXISTS idx_name_name ON comp_name(name);`;

export const createCompImageTable = `
CREATE TABLE IF NOT EXISTS comp_image (
    entity TEXT PRIMARY KEY REFERENCES entities(ulid) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    mime_type TEXT,
    width INTEGER,
    height INTEGER,
    uri TEXT
) STRICT;
`;
export const createCompImageIndex = `CREATE INDEX IF NOT EXISTS idx_image_uri ON comp_image(uri);`;

export const createCompIdentifierTable = `

CREATE TABLE IF NOT EXISTS comp_identifier (
    entity TEXT PRIMARY KEY REFERENCES entities(ulid) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    public_key BLOB
) STRICT;
`;
export const createCompIdentifierIndex = `CREATE INDEX IF NOT EXISTS idx_identifier_public_key ON comp_identifier(public_key);`;

export const createCompDescriptionTable = `
CREATE TABLE IF NOT EXISTS comp_description (
    entity TEXT PRIMARY KEY REFERENCES entities(ulid) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    description TEXT
) STRICT;
`;
export const createCompDescriptionIndex = `CREATE INDEX IF NOT EXISTS idx_description_description ON comp_description(description);`;

export const createCompUrlTable = `

CREATE TABLE IF NOT EXISTS comp_url (
    entity TEXT PRIMARY KEY REFERENCES entities(ulid) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    url TEXT
) STRICT;
`;
export const createCompUrlIndex = `CREATE INDEX IF NOT EXISTS idx_url_url ON comp_url(url);`;
