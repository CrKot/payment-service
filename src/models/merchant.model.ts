import { Schema, model, InferSchemaType } from 'mongoose';

const merchantSchema = new Schema(
  {
    name: { type: String, required: true },
    // Комиссия в базисных пунктах: 250 = 2.5%. Целое, без float.
    feePercentBps: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

export type Merchant = InferSchemaType<typeof merchantSchema>;
export const MerchantModel = model('Merchant', merchantSchema);
