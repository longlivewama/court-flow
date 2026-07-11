// test-financials.ts
import { createBooking } from './backend/src/application/booking/create-booking.usecase.ts';


async function runScenarioA() {
  console.log('Scenario A: discount and full payment');
  const input = {
    clubId: '46abdd26-4bd6-4a81-b5d2-29d25b0a5663',
    courtId: '552e6225-d37f-49db-8179-67f8995ffe25', // existing court
    customerId: 'cf1c79b1-7c77-42ef-8278-e0d4ed4e0f02', // existing customer
    createdBy: '6c269890-1e09-4cd2-a5e4-2a4ea8b853ce',
    createdByRole: 'receptionist',
    startTime: new Date(Date.now() + 3600 * 1000), // 1 hour from now
    durationMinutes: 60 as 60 | 90 | 120,
    notes: 'Test booking',
    discountAmount: 10,
    amountPaid: 90, // assume totalPrice after discount = 90
    paymentMethod: 'VODAFONE_CASH',
    adminNotes: 'Applied discount',
    processedById: '6c269890-1e09-4cd2-a5e4-2a4ea8b853ce',
    ipAddress: '127.0.0.1',
    deviceInfo: 'test-agent',
  };
  const result = await createBooking(input as any);
  console.log('Result A:', result);
}

async function runScenarioB() {
  console.log('Scenario B: partial payment');
  const input = {
    clubId: process.env.CLUB_ID!,
    courtId: '552e6225-d37f-49db-8179-67f8995ffe25', // existing court
    customerId: 'cf1c79b1-7c77-42ef-8278-e0d4ed4e0f02', // existing customer
    createdBy: '6c269890-1e09-4cd2-a5e4-2a4ea8b853ce',
    createdByRole: 'receptionist',
    startTime: new Date(Date.now() + 7200 * 1000), // 2 hours from now
    durationMinutes: 60 as 60 | 90 | 120,
    notes: 'Test booking B',
    discountAmount: 0,
    amountPaid: 30, // partial
    paymentMethod: 'VODAFONE_CASH',
    adminNotes: null,
    processedById: '6c269890-1e09-4cd2-a5e4-2a4ea8b853ce',
    ipAddress: '127.0.0.1',
    deviceInfo: 'test-agent',
  };
  const result = await createBooking(input as any);
  console.log('Result B:', result);
}

(async () => {
  try {
    await runScenarioA();
    await runScenarioB();
  } catch (e) {
    console.error('Error during tests:', e);
  }
})();
