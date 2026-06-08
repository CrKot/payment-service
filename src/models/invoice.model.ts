import { Schema, model, InferSchemaType, Types } from 'mongoose';

export const INVOICE_STATUSES = ['pending', 'paid', 'failed'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

const invoiceSchema = new Schema(
  {
    merchantId: { type: Schema.Types.ObjectId, ref: 'Merchant', required: true, index: true },
    // Суммы — целые, в минорных единицах валюты (копейки/центы).
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    fee: { type: Number, required: true, min: 0 },
    amountToReceive: { type: Number, required: true, min: 0 },
    status: { type: String, enum: INVOICE_STATUSES, default: 'pending', required: true, index: true },
    // Внутренний флаг: зачисление захвачено и выполняется. В API не отдаётся.
    // Нужен, чтобы settle() выполнялся ровно один раз И чтобы при сбое settle
    // инвойс не «застрял» оплаченным без фактического зачисления (см. TQA-1).
    settleInProgress: { type: Boolean, default: false },
    // Проставляется ровно один раз в момент успешного зачисления (status -> paid).
    settledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type Invoice = InferSchemaType<typeof invoiceSchema> & { _id: Types.ObjectId };
export const InvoiceModel = model('Invoice', invoiceSchema);
