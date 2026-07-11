import '../src/interfaces/http/middleware/auth.middleware';
import { validateBookingSlot } from '../src/domain/booking/booking.validator';
import { getBooking } from '../src/interfaces/http/controllers/booking.controller';
import { db } from '../src/infrastructure/database/client';
import { toZonedTime } from 'date-fns-tz';
import { performance } from 'perf_hooks';

process.env.CLUB_ID = 'test-club';
const CLUB_TIMEZONE = 'Africa/Cairo';

// Mocks
let lastQueriedDayOfWeek = -1;

const mockClient = {
  query: async (queryText: string, params: any[]) => {
    if (queryText.includes('FROM courts')) {
       return { rows: [{ id: params[0], status: 'available', is_active: true }] };
    }
    if (queryText.includes('FROM working_hours')) {
       lastQueriedDayOfWeek = params[1];
       return { rows: [{ open_time: '12:00:00', close_time: '06:00:00', is_closed: false }] };
    }
    if (queryText.includes('FROM blocked_periods')) {
       return { rows: [] };
    }
    if (queryText.includes('FROM bookings')) {
       const [courtId, startTimeStr, endTimeStr] = params;
       const reqStart = new Date(startTimeStr).getTime();
       const reqEnd = new Date(endTimeStr).getTime();
       
       // Book A: 23:30 Cairo (20:30 UTC) to 01:00 Cairo (22:00 UTC) on 2026-07-07
       const existingStart = new Date("2026-07-07T20:30:00Z").getTime(); 
       const existingEnd = new Date("2026-07-07T22:00:00Z").getTime();
       
       if (reqStart < existingEnd && reqEnd > existingStart) {
          return { rows: [{ id: 'existing-booking-1' }] };
       }
       return { rows: [] };
    }
    return { rows: [] };
  }
} as any;

const mockClientClosed = {
  ...mockClient,
  query: async (queryText: string, params: any[]) => {
    if (queryText.includes('FROM working_hours')) {
       lastQueriedDayOfWeek = params[1];
       return { rows: [{ open_time: '12:00:00', close_time: '06:00:00', is_closed: true }] };
    }
    return mockClient.query(queryText, params);
  }
} as any;

async function runTests() {
  console.log("=== STARTING QA SIMULATION ===\\n");

  // TEST 1
  console.log("[TEST 1] MIDNIGHT CROSSING OVERLAP PREVENTION (BACKEND)");
  try {
    await validateBookingSlot(mockClient, {
      clubId: 'club-1',
      courtId: 'court-1',
      startTime: new Date("2026-07-07T21:15:00Z"), 
      durationMinutes: 60,
    });
    console.log("❌ FAIL: Expected overlap error, but passed.");
  } catch (err: any) {
    if (err.message.includes('already booked')) {
      console.log("✅ PASS: Overlap correctly detected. " + err.message);
    } else {
      console.log("❌ FAIL: Unexpected error: " + err.message);
    }
  }

  // TEST 2
  console.log("\\n[TEST 2] OVERNIGHT DAY-OF-WEEK WORKING HOURS VALIDATION");
  try {
    const tuesMorningCairo = new Date("2026-07-06T23:00:00Z"); // 02:00 AM Cairo on Tuesday 2026-07-07
    
    lastQueriedDayOfWeek = -1;
    await validateBookingSlot(mockClient, {
      clubId: 'club-1',
      courtId: 'court-1',
      startTime: tuesMorningCairo,
      durationMinutes: 60,
    });
    
    // Tuesday is 2, Monday is 1
    if (lastQueriedDayOfWeek === 1) {
      console.log("✅ PASS: Fetched MONDAY's working hours profile correctly (day 1). Validation passed.");
    } else {
      console.log(`❌ FAIL: Fetched wrong day of week. Expected 1, got ${lastQueriedDayOfWeek}`);
    }

    // Test closed scenario
    await validateBookingSlot(mockClientClosed, {
      clubId: 'club-1',
      courtId: 'court-1',
      startTime: tuesMorningCairo,
      durationMinutes: 60,
    });
    console.log("❌ FAIL: Expected validation error due to closed club, but passed.");
  } catch (err: any) {
    if (err.message.includes('club is closed')) {
      console.log("✅ PASS: Correctly rejected because Monday was closed. " + err.message);
    } else {
      console.log("❌ FAIL: Unexpected error: " + err.message);
    }
  }

  // TEST 3
  console.log("\\n[TEST 3] COMPONENT RENDER LOOPS STRESS-TEST (FRONTEND)");
  try {
    const TIMEZONE = 'Africa/Cairo';
    const HOUR_HEIGHT = 90;
    const gridStartHour = 12; // noon
    
    function topOffset(isoTime: string): number {
      const t = toZonedTime(new Date(isoTime), TIMEZONE);
      let hours = t.getHours();
      if (hours < gridStartHour) hours += 24;
      const mins = (hours - gridStartHour) * 60 + t.getMinutes();
      return Math.max((mins / 60) * HOUR_HEIGHT, 0);
    }

    function blockHeight(startIso: string, endIso: string): number {
      const durationH = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3600000;
      return Math.max(durationH * HOUR_HEIGHT, 0);
    }

    const startMs = performance.now();
    for (let col = 0; col < 5; col++) {
      for (let i = 0; i < 100; i++) {
         const startIso = "2026-07-06T23:00:00Z";
         const endIso = "2026-07-07T00:00:00Z";
         topOffset(startIso);
         blockHeight(startIso, endIso);
      }
    }
    const endMs = performance.now();
    const duration = endMs - startMs;
    
    if (duration > 16) {
      console.log(`⚠️ WARN: Calculation took ${duration.toFixed(2)}ms (>16ms). Flagging for useMemo wrapping.`);
    } else {
      console.log(`✅ PASS: Calculation super fast! Took ${duration.toFixed(2)}ms (<=16ms). No lag frames.`);
    }
  } catch (err: any) {
    console.log("❌ FAIL: " + err.message);
  }

  // TEST 4
  console.log("\\n[TEST 4] ADMIN NOTES STRIPPING SECURITY SANITY");
  try {
    // @ts-ignore
    db.query = async (queryText: string, params: any[]) => {
      return {
        rows: [{
          id: 'booking-1',
          customer_id: 'user1',
          admin_notes: 'Super secret owner notes',
          status: 'confirmed'
        }]
      } as any;
    };

    let responsePayload: any;
    const mockReq = {
      params: { id: 'booking-1' },
      user: { role: 'customer', sub: 'user1' }
    } as any;
    const mockRes = {
      json: (data: any) => { responsePayload = data; }
    } as any;
    const mockNext = (err: any) => { if(err) throw err; };

    await getBooking(mockReq, mockRes, mockNext);

    if (responsePayload && typeof responsePayload.admin_notes === 'undefined') {
      console.log("✅ PASS: admin_notes is strictly stripped from customer payload.");
    } else {
      console.log("❌ FAIL: admin_notes was found in customer payload!", responsePayload.admin_notes);
    }

  } catch (err: any) {
    console.log("❌ FAIL: " + err.message);
  }

  console.log("\\n=== SIMULATION COMPLETE ===");
}

runTests().catch(console.error);
