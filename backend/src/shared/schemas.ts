import { z } from 'zod';

export const bookingSchema = z.object({
  court_id:       z.string().optional(),
  courtId:        z.string().optional(),
  customer_id:    z.string().optional(),
  customerId:     z.string().optional(),
  /** Walk-in customer name – used by staff when no account exists */
  customerName:   z.string().optional(),
  /** Walk-in customer phone – used by staff when no account exists */
  customerPhone:  z.string().optional(),
  start_time:     z.string().optional(),
  startTime:      z.string().optional(),
  duration_minutes: z.number().int().positive().optional(),
  durationMinutes:  z.number().int().positive().optional(),
  notes:            z.string().optional(),
  discount_amount:  z.number().min(0).optional(),
  discountAmount:   z.number().min(0).optional(),
  deposit_amount:   z.number().min(0).optional(),
  depositAmount:    z.number().min(0).optional(),
  deposit_method:   z.enum(['INSTAPAY', 'VODAFONE_CASH', 'CASH', 'NONE']).optional(),
  depositMethod:    z.enum(['INSTAPAY', 'VODAFONE_CASH', 'CASH', 'NONE']).optional(),
  remainder_amount: z.number().min(0).optional(),
  remainderAmount:  z.number().min(0).optional(),
  remainder_method: z.enum(['INSTAPAY', 'VODAFONE_CASH', 'CASH', 'NONE']).optional(),
  remainderMethod:  z.enum(['INSTAPAY', 'VODAFONE_CASH', 'CASH', 'NONE']).optional(),
  /** Customer self-reported payment – stored as the booking deposit until verified */
  amount_paid:      z.number().min(0).optional(),
  amountPaid:       z.number().min(0).optional(),
  payment_method:   z.enum(['INSTAPAY', 'VODAFONE_CASH', 'CASH', 'NONE']).optional(),
  paymentMethod:    z.enum(['INSTAPAY', 'VODAFONE_CASH', 'CASH', 'NONE']).optional(),
  /** Staff/owner only – stripped before persistence when actor is customer */
  admin_notes:    z.string().optional(),
  adminNotes:     z.string().optional(),
});

export const workingHoursSchema = z.object({
  hours: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      openTime: z.string(),
      closeTime: z.string(),
      isClosed: z.boolean()
    })
  )
});

/**
 * Analytics plots – returned by GET /api/bookings/analytics-plots.
 * Provides two chart channels for the owner reporting UI.
 */
export const paymentDistributionSliceSchema = z.object({
  name:  z.enum(['CASH', 'VODAFONE_CASH', 'INSTAPAY']),
  value: z.number(),
});

export const hourlyPeakSliceSchema = z.object({
  hour:          z.string(),   // e.g. "18:00"
  bookingsCount: z.number().int(),
});

export const analyticsPlotSchema = z.object({
  rangeDays:           z.number().int(),
  generatedAt:         z.string(),
  paymentDistribution: z.array(paymentDistributionSliceSchema),
  hourlyPeakTraffic:   z.array(hourlyPeakSliceSchema),
});

