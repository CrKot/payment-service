import { isValidObjectId } from 'mongoose';
import { InvoiceModel } from '../../models/invoice.model';
import { MerchantModel } from '../../models/merchant.model';
import { computeFee, computeAmountToReceive } from '../../lib/money';
import { AppError } from '../../lib/errors';
import type { CreateInvoiceDto } from './invoice.dto';

export async function createInvoice(dto: CreateInvoiceDto) {
  const merchant = await MerchantModel.findById(dto.merchantId);
  if (!merchant) {
    throw new AppError(404, 'MERCHANT_NOT_FOUND', `Merchant ${dto.merchantId} not found`);
  }

  const fee = computeFee(dto.amount, merchant.feePercentBps);
  const amountToReceive = computeAmountToReceive(dto.amount, fee);

  const invoice = await InvoiceModel.create({
    merchantId: merchant._id,
    amount: dto.amount,
    currency: dto.currency.toUpperCase(),
    fee,
    amountToReceive,
    status: 'pending',
  });

  return invoice;
}

export async function getInvoice(id: string) {
  if (!isValidObjectId(id)) {
    throw new AppError(400, 'INVALID_ID', 'Invoice id must be a valid ObjectId');
  }
  const invoice = await InvoiceModel.findById(id);
  if (!invoice) {
    throw new AppError(404, 'INVOICE_NOT_FOUND', `Invoice ${id} not found`);
  }
  return invoice;
}
