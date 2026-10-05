import {
  IsDefined,
  IsIn,
  ValidateIf,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

export const MANUAL_MOVEMENT_TYPES = [
  'OPENING_STOCK',
  'PURCHASE',
  'ADJUSTMENT',
  'RETURN',
  'DAMAGE',
] as const;

export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

const POSITIVE_STOCK = /^(?!0+(?:\.0+)?$)\d{1,9}(\.\d{1,3})?$/;
const NON_NEGATIVE_STOCK = /^\d{1,9}(\.\d{1,3})?$/;

@ValidatorConstraint({ name: 'manualMovementAmounts', async: false })
class ManualMovementAmountsConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as {
      type?: string;
      quantity?: unknown;
      targetStock?: unknown;
    };
    if (dto.type === 'ADJUSTMENT') {
      return dto.quantity === undefined;
    }
    if (
      dto.type === 'OPENING_STOCK' ||
      dto.type === 'PURCHASE' ||
      dto.type === 'RETURN' ||
      dto.type === 'DAMAGE'
    ) {
      return dto.targetStock === undefined;
    }
    return true;
  }

  defaultMessage(): string {
    return 'Movement quantity does not match the movement type.';
  }
}

export class CreateInventoryMovementDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsIn(MANUAL_MOVEMENT_TYPES)
  @Validate(ManualMovementAmountsConstraint)
  type: ManualMovementType;

  @ValidateIf((dto: CreateInventoryMovementDto) => dto.type !== 'ADJUSTMENT')
  @IsDefined()
  @IsString()
  @Matches(POSITIVE_STOCK)
  quantity?: string;

  @ValidateIf((dto: CreateInventoryMovementDto) => dto.type === 'ADJUSTMENT')
  @IsDefined()
  @IsString()
  @Matches(NON_NEGATIVE_STOCK)
  targetStock?: string;

  @IsOptional()
  @IsString()
  note?: string | null;
}
