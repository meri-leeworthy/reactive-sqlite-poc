// Child Parent Subscribe Member Ban Hide Pin LastRead Embed Reply BranchThread Author Reorder Source Avatar

import type { EntityId } from "./entities";

export type EdgeLabel =
  | "child"
  | "parent"
  | "subscribe"
  | "member"
  | "ban"
  | "hide"
  | "pin"
  | "last_read"
  | "embed"
  | "reply"
  | "link"
  | "author"
  | "reorder"
  | "source"
  | "avatar"
  | "reaction";

export interface EdgeReaction {
  reaction: string;
}

export interface EdgeLastRead {
  timestamp: number;
}

export interface EdgeMember {
  delegation: string;
}

export type EdgesMap = {
  [K in Exclude<EdgeLabel, "reaction" | "last_read" | "member">]: null;
} & {
  reaction: EdgeReaction;
  last_read: EdgeLastRead;
  member: EdgeMember;
};

/** Given a tuple of edge names, produces a record whose keys are exactly
 * those edge names and whose values are arrays of the corresponding edge types.
 */
export type EdgesRecord<TRequired extends readonly EdgeLabel[]> = {
  [K in TRequired[number]]: [EdgesMap[K], EntityId];
};
