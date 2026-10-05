import type { InventoryMovementType } from '../../../generated/prisma/client.js';

export type InventoryMovementResponse = {
  id: string;
  productId: string;
  type: InventoryMovementType;
  quantity: string;
  previousStock: string;
  newStock: string;
  note: string | null;
  createdById: string | null;
  createdAt: Date;
};

export type InventoryMovementListResponse = {
  movements: InventoryMovementResponse[];
};
