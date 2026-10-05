export type CategoryResponse = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CategoryListResponse = {
  categories: CategoryResponse[];
};
