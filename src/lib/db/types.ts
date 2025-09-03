// Auto-generated from * tables in schema.ts to mirror component shapes

export type ComponentName =
  | "profile"
  | "config"
  | "page"
  | "upload_media"
  | "user_access_times"
  | "text_content"
  | "name"
  | "image"
  | "identifier"
  | "description"
  | "url";

export interface BaseComponent {
  entity: string;
  created_at: number;
  updated_at: number;
}

export interface CompProfile extends BaseComponent {
  blueskyHandle: string | null;
  bannerUrl: string | null;
  joinedDate: number | null;
}

export interface CompConfig extends BaseComponent {
  // Stored as TEXT with json_valid(config) constraint
  config: string | null;
}

export type CompPage = BaseComponent;

export type UploadMediaType = "image" | "video";
export type UploadMediaStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface CompUploadMedia extends BaseComponent {
  media_type: UploadMediaType | null;
  status: UploadMediaStatus | null;
  url: string | null;
  attach_to_message_id: Uint8Array | null;
}

export type CompUserAccessTimes = BaseComponent;

export interface CompTextContent extends BaseComponent {
  text: string | null;
  format: string | null;
}

export interface CompName extends BaseComponent {
  name: string | null;
}

export interface CompImage extends BaseComponent {
  mime_type: string | null;
  width: number | null;
  height: number | null;
  uri: string | null;
}

export interface CompIdentifier extends BaseComponent {
  public_key: Uint8Array | null;
}

export interface CompDescription extends BaseComponent {
  description: string | null;
}

export interface CompUrl extends BaseComponent {
  url: string | null;
}

export type ComponentMap = {
  profile: CompProfile;
  config: CompConfig;
  page: CompPage;
  upload_media: CompUploadMedia;
  user_access_times: CompUserAccessTimes;
  text_content: CompTextContent;
  name: CompName;
  image: CompImage;
  identifier: CompIdentifier;
  description: CompDescription;
  url: CompUrl;
};
