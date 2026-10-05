export type ProductResponse = {
  id: string;
  categoryId: string;
  name: string;
  sku: string | null;
  description: string | null;
  sellingPrice: string;
  gstRate: string;
  stockQty: string;
  unit: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ProductListResponse = {
  products: ProductResponse[];
};
