import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { validateBody } from '../../middlewares/validate';
import { createInvoiceSchema } from './invoice.dto';
import * as controller from './invoice.controller';

export const invoiceRouter = Router();

invoiceRouter.post('/', validateBody(createInvoiceSchema), asyncHandler(controller.create));
invoiceRouter.get('/:id', asyncHandler(controller.getById));
