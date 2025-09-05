// Event type definitions inferred from schema and domain types

import type { EntityId, EntityLabel } from "./entities";
import type { BaseComponent, ComponentMap, ComponentName } from "./components";
import type {
  EdgeLabel,
  EdgeMember,
  EdgeReaction,
  EdgeLastRead,
} from "./edges";

// ========= Helpers =========

// Component payload for events excludes runtime-managed base fields
export type ComponentData<K extends ComponentName> = Omit<
  ComponentMap[K],
  keyof BaseComponent
>;

export type PayloadEdgeLabel = "reaction" | "last_read" | "member";

export type EdgePayload<K extends EdgeLabel> = K extends "reaction"
  ? EdgeReaction
  : K extends "last_read"
    ? EdgeLastRead
    : K extends "member"
      ? EdgeMember
      : null;

// ========= Core (low-level) events =========

export interface CoreEventBase<TType extends string> {
  // ULID of the event (event_ulid in DB)
  eventId: string;
  // Subject entity for the mutation (entity_ulid in DB)
  entityId: EntityId;
  type: TType;
  createdAt?: number; // milliseconds epoch (optional, DB defaults)
}

export type EntityCreateEvent = CoreEventBase<"entity.create"> & {
  label: EntityLabel;
};

export type EntityDeleteEvent = CoreEventBase<"entity.delete">;

export type EntitySetLabelEvent = CoreEventBase<"entity.set_label"> & {
  label: EntityLabel;
};

export type ComponentUpsertEvent<K extends ComponentName = ComponentName> =
  CoreEventBase<"component.upsert"> & {
    component: K;
    // Partial updates allowed; ingestion will apply and set timestamps
    data: Partial<ComponentData<K>>;
  };

export type ComponentRemoveEvent<K extends ComponentName = ComponentName> =
  CoreEventBase<"component.remove"> & {
    component: K;
  };

export type EdgeAddEvent<K extends EdgeLabel = EdgeLabel> =
  CoreEventBase<"edge.add"> & {
    label: K;
    head: EntityId;
    tail: EntityId;
    payload: EdgePayload<K>;
  };

export type EdgeRemoveEvent<K extends EdgeLabel = EdgeLabel> =
  CoreEventBase<"edge.remove"> & {
    label: K;
    head: EntityId;
    tail: EntityId;
  };

export type EdgeUpdateEvent<K extends PayloadEdgeLabel = PayloadEdgeLabel> =
  CoreEventBase<"edge.update"> & {
    label: K;
    head: EntityId;
    tail: EntityId;
    payload: EdgePayload<K>;
  };

export type CoreEvent =
  | EntityCreateEvent
  | EntityDeleteEvent
  | EntitySetLabelEvent
  | ComponentUpsertEvent
  | ComponentRemoveEvent
  | EdgeAddEvent
  | EdgeRemoveEvent
  | EdgeUpdateEvent;

// ========= Domain (application-level) events =========

export interface DomainEventBase<TType extends string> {
  eventId: string;
  type: TType;
  createdAt?: number;
  // Optional actor performing the mutation
  actorId?: EntityId;
}

// User
export type UserCreateEvent = DomainEventBase<"user.create"> & {
  userId: EntityId;
  name?: Partial<ComponentData<"name">>;
  description?: Partial<ComponentData<"description">>;
  profile?: Partial<ComponentData<"profile">>;
  config?: Partial<ComponentData<"config">>;
  avatarImageId?: EntityId; // link via avatar edge
};

export type UserSubscribeThreadEvent =
  DomainEventBase<"user.subscribe_thread"> & {
    userId: EntityId;
    threadId: EntityId;
  };

// Space
export type SpaceCreateEvent = DomainEventBase<"space.create"> & {
  spaceId: EntityId;
  name?: Partial<ComponentData<"name">>;
  description?: Partial<ComponentData<"description">>;
  avatarImageId?: EntityId;
};

export type SpaceAddMemberEvent = DomainEventBase<"space.add_member"> & {
  spaceId: EntityId;
  userId: EntityId;
  member: EdgeMember; // includes delegation
};

export type SpaceRemoveMemberEvent = DomainEventBase<"space.remove_member"> & {
  spaceId: EntityId;
  userId: EntityId;
  revocation: string; // should be stored in the event log for verification, but not needed in other tables
};

export type SpaceBanUserEvent = DomainEventBase<"space.ban_user"> & {
  spaceId: EntityId;
  userId: EntityId;
  reason?: string;
};

// Thread / Page
export type ThreadCreateEvent = DomainEventBase<"thread.create"> & {
  threadId: EntityId;
  spaceId?: EntityId; // parent space (member edge from space -> thread)
  name?: Partial<ComponentData<"name">>;
  description?: Partial<ComponentData<"description">>;
};

export type ThreadPinMessageEvent = DomainEventBase<"thread.pin_message"> & {
  threadId: EntityId;
  messageId: EntityId;
};

export type PageCreateEvent = DomainEventBase<"page.create"> & {
  pageId: EntityId;
  name?: Partial<ComponentData<"name">>;
  description?: Partial<ComponentData<"description">>;
};

export type ThreadMarkReadEvent = DomainEventBase<"thread.mark_read"> & {
  userId: EntityId;
  threadId: EntityId;
  timestamp: EdgeLastRead["timestamp"];
};

// Message
export type MessagePostEvent = DomainEventBase<"message.post"> & {
  messageId: EntityId;
  threadId: EntityId;
  authorUserId: EntityId; // author edge
  text?: Partial<ComponentData<"text_content">>;
  replyToMessageId?: EntityId; // reply edge
  embedEntityId?: EntityId; // embed edge to media/embed entity
};

export type MessageEditEvent = DomainEventBase<"message.edit"> & {
  messageId: EntityId;
  text?: Partial<ComponentData<"text_content">>;
};

export type MessageDeleteEvent = DomainEventBase<"message.delete"> & {
  messageId: EntityId;
};

export type MessageReactEvent = DomainEventBase<"message.react"> & {
  messageId: EntityId;
  userId: EntityId;
  reaction: EdgeReaction["reaction"];
};

export type MessageUnreactEvent = DomainEventBase<"message.unreact"> & {
  messageId: EntityId;
  userId: EntityId;
  reaction: EdgeReaction["reaction"];
};

export type MessageReorderEvent = DomainEventBase<"message.reorder"> & {
  messageId: EntityId;
  afterMessageId: EntityId | null; // null = move to start
};

// Uploads
export type UploadStartEvent = DomainEventBase<"upload.start"> & {
  uploadId: EntityId;
  mediaType?: ComponentMap["upload"]["media_type"];
  attachToMessageId?: EntityId;
};

export type UploadCompleteEvent = DomainEventBase<"upload.complete"> & {
  uploadId: EntityId;
  url: ComponentMap["upload"]["url"];
};

export type UploadFailEvent = DomainEventBase<"upload.fail"> & {
  uploadId: EntityId;
  error: string;
};

// Misc
export type EntitySetAvatarEvent = DomainEventBase<"entity.set_avatar"> & {
  entityId: EntityId;
  imageId: EntityId;
};

export type DomainEvent =
  | UserCreateEvent
  | UserSubscribeThreadEvent
  | SpaceCreateEvent
  | SpaceAddMemberEvent
  | SpaceRemoveMemberEvent
  | SpaceBanUserEvent
  | ThreadCreateEvent
  | ThreadPinMessageEvent
  | PageCreateEvent
  | ThreadMarkReadEvent
  | MessagePostEvent
  | MessageEditEvent
  | MessageDeleteEvent
  | MessageReactEvent
  | MessageUnreactEvent
  | MessageReorderEvent
  | UploadStartEvent
  | UploadCompleteEvent
  | UploadFailEvent
  | EntitySetAvatarEvent;

export type AnyEvent = CoreEvent | DomainEvent;
