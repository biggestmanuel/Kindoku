export type MediaType = 'Manga' | 'Manhwa' | 'Manhua' | 'Light Novel';

export interface Recommendation {
  title: string;
  type: MediaType | string;
  genre: string[];
  synopsis: string | null;
  status: string;
  rating: string | null;
  coverImage?: string | null;
  coverHint?: string | null;
  readUrl: string;
  // true only when AniList returned a real reading-site link — Google
  // search fallback links are always false, and always open in a new
  // tab instead of the in-app reader (see ReaderOverlay).
  isDirectLink: boolean;
}

export interface RecommendResponse {
  recommendations?: Recommendation[];
  model?: string;
  isExact?: boolean;
  error?: string;
}

export interface DiscoverRequestBody {
  mode: 'discover';
  genres: string[];
  tags: string[];
  formats: string[];
  customInput: string;
  exclude: string[];
}

export interface SearchRequestBody {
  mode: 'search';
  searchInput: string;
}

export type RecommendRequestBody = DiscoverRequestBody | SearchRequestBody;

export type ViewName = 'landing' | 'search' | 'discover' | 'results';

export interface DiscoverQueryState {
  mode: 'discover';
  genres: string[];
  tags: string[];
  formats: string[];
  customInput: string;
  searchInput: '';
}

export interface SearchQueryState {
  mode: 'search';
  searchInput: string;
  genres: [];
  tags: [];
  formats: [];
  customInput: '';
}

export type CurrentQuery = DiscoverQueryState | SearchQueryState;
