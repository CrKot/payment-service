import type { Request, Response } from 'express';
import * as invoiceService from './invoice.service';

function serialize(invoice: Awaited<ReturnType<typeof invoiceService.getInvoice>>) {
  return {
    invoiceId: invoice._id.toString(),
    merchantId: invoice.merchantId.toString(),
    amount: invoice.amount,
    currency: invoice.currency,
    fee: invoice.fee,
    amountToReceive: invoice.amountToReceive,
    status: invoice.status,
    settledAt: invoice.settledAt,
  };
}

export async function create(req: Request, res: Response) {
  const invoice = await invoiceService.createInvoice(req.body);
  res.status(201).json(serialize(invoice));
}

export async function getById(req: Request, res: Response) {
  const invoice = await invoiceService.getInvoice(req.params.id);
  res.status(200).json(serialize(invoice));
}
