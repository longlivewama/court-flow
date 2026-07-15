/**
 * Tournament Controller – leagues, brackets, and registration-fee tracking.
 *
 * Owner:    create tournaments, set fees, enter/manage teams, generate the
 *           single-elimination bracket, record match results.
 * Customer: browse open tournaments, register a team, pay the fee online.
 *
 * Money is tracked per team: amount_due is snapshotted from the tournament's
 * registration fee at sign-up, amount_paid accumulates recorded payments, so
 * "collected vs. outstanding" is always exact — per tournament and club-wide.
 */
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../../../infrastructure/database/client';
import { auditLog, AUDIT_ACTIONS } from '../../../infrastructure/audit/audit.service';
import { NotFoundError, ValidationError, ForbiddenError, ConflictError } from '../../../shared/errors';

const CLUB_ID = process.env.CLUB_ID!;

const STAFF_ROLES = ['receptionist', 'owner', 'admin'];

function isStaff(role: string): boolean {
  return STAFF_ROLES.includes(role);
}

function paymentStatus(due: number, paid: number): 'paid' | 'partial' | 'pending' {
  if (due <= 0 || paid >= due) return 'paid';
  return paid > 0 ? 'partial' : 'pending';
}

// ── GET /api/tournaments ──────────────────────────────────────
export async function listTournaments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await db.query(
      `SELECT t.id, t.name, t.description, t.registration_fee, t.max_teams,
              t.starts_at, t.status, t.created_at,
              COUNT(tt.id)::int                                           AS team_count,
              COALESCE(SUM(tt.amount_paid), 0)::numeric                   AS collected,
              COALESCE(SUM(GREATEST(tt.amount_due - tt.amount_paid, 0)), 0)::numeric AS outstanding
       FROM tournaments t
       LEFT JOIN tournament_teams tt ON tt.tournament_id = t.id
       WHERE t.club_id = $1
       GROUP BY t.id
       ORDER BY (t.status IN ('registration_open','in_progress')) DESC, t.starts_at DESC`,
      [CLUB_ID]
    );

    res.json({
      data: rows.map((r) => ({
        ...r,
        registration_fee: Number(r.registration_fee),
        collected:        Number(r.collected),
        outstanding:      Number(r.outstanding),
      })),
    });
  } catch (err) { next(err); }
}

const createSchema = z.object({
  name:            z.string().trim().min(3).max(150),
  description:     z.string().trim().max(2000).optional(),
  registrationFee: z.number().min(0),
  maxTeams:        z.number().int().min(2).max(128).default(16),
  startsAt:        z.string().datetime({ offset: true }).or(z.string().datetime()),
});

// ── POST /api/tournaments (owner) ─────────────────────────────
export async function createTournament(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = createSchema.parse(req.body);

    const { rows } = await db.query(
      `INSERT INTO tournaments (club_id, name, description, registration_fee, max_teams, starts_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [CLUB_ID, parsed.name, parsed.description ?? null, parsed.registrationFee,
       parsed.maxTeams, parsed.startsAt, req.user!.sub]
    );

    await auditLog({
      clubId: CLUB_ID, userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.TOURNAMENT_CREATED,
      entityType: 'tournament', entityId: rows[0].id,
      newValues: { name: parsed.name, registrationFee: parsed.registrationFee, maxTeams: parsed.maxTeams },
    });

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

// ── GET /api/tournaments/:id ──────────────────────────────────
// Full detail: teams (with payment tracking) + bracket matches.
// Customers see team names and the bracket; per-team payment amounts are
// only included for staff, plus the caller's own team.
export async function getTournament(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows: tRows } = await db.query(
      `SELECT * FROM tournaments WHERE id = $1 AND club_id = $2`,
      [req.params.id, CLUB_ID]
    );
    if (!tRows.length) throw new NotFoundError('Tournament', req.params.id);
    const t = tRows[0];

    const { rows: teamRows } = await db.query(
      `SELECT tt.id, tt.name, tt.captain_id, tt.contact_phone, tt.amount_due,
              tt.amount_paid, tt.payment_method, tt.paid_at, tt.seed, tt.created_at,
              u.first_name || ' ' || u.last_name AS captain_name,
              u.email AS captain_email
       FROM tournament_teams tt
       LEFT JOIN users u ON u.id = tt.captain_id
       WHERE tt.tournament_id = $1
       ORDER BY tt.created_at`,
      [req.params.id]
    );

    const { rows: matchRows } = await db.query(
      `SELECT id, round, position, team1_id, team2_id, winner_id, score1, score2, played_at
       FROM tournament_matches
       WHERE tournament_id = $1
       ORDER BY round, position`,
      [req.params.id]
    );

    const staff = isStaff(req.user!.role);
    const teams = teamRows.map((team) => {
      const due  = Number(team.amount_due);
      const paid = Number(team.amount_paid);
      const mine = team.captain_id === req.user!.sub;
      const base = {
        id: team.id, name: team.name, seed: team.seed, created_at: team.created_at,
        captain_name: team.captain_name, is_mine: mine,
        payment_status: paymentStatus(due, paid),
      };
      if (!staff && !mine) return base;
      return {
        ...base,
        captain_email:  team.captain_email,
        contact_phone:  team.contact_phone,
        amount_due:     due,
        amount_paid:    paid,
        outstanding:    Math.max(due - paid, 0),
        payment_method: team.payment_method,
        paid_at:        team.paid_at,
      };
    });

    const collected   = teamRows.reduce((s, r) => s + Number(r.amount_paid), 0);
    const outstanding = teamRows.reduce((s, r) => s + Math.max(Number(r.amount_due) - Number(r.amount_paid), 0), 0);

    res.json({
      ...t,
      registration_fee: Number(t.registration_fee),
      teams,
      matches: matchRows,
      stats: {
        teamCount:  teamRows.length,
        collected,
        outstanding,
        paidTeams:  teamRows.filter((r) => paymentStatus(Number(r.amount_due), Number(r.amount_paid)) === 'paid').length,
      },
    });
  } catch (err) { next(err); }
}

const updateSchema = z.object({
  name:            z.string().trim().min(3).max(150).optional(),
  description:     z.string().trim().max(2000).nullable().optional(),
  registrationFee: z.number().min(0).optional(),
  maxTeams:        z.number().int().min(2).max(128).optional(),
  startsAt:        z.string().datetime({ offset: true }).or(z.string().datetime()).optional(),
  status:          z.enum(['registration_open', 'in_progress', 'completed', 'cancelled']).optional(),
});

// ── PATCH /api/tournaments/:id (owner) ────────────────────────
export async function updateTournament(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = updateSchema.parse(req.body);

    const { rows: existingRows } = await db.query(
      `SELECT * FROM tournaments WHERE id = $1 AND club_id = $2`,
      [req.params.id, CLUB_ID]
    );
    if (!existingRows.length) throw new NotFoundError('Tournament', req.params.id);

    const { rows } = await db.query(
      `UPDATE tournaments
         SET name             = COALESCE($2, name),
             description      = COALESCE($3, description),
             registration_fee = COALESCE($4, registration_fee),
             max_teams        = COALESCE($5, max_teams),
             starts_at        = COALESCE($6, starts_at),
             status           = COALESCE($7, status),
             updated_at       = NOW()
       WHERE id = $1 AND club_id = $8
       RETURNING *`,
      [req.params.id, parsed.name ?? null, parsed.description ?? null,
       parsed.registrationFee ?? null, parsed.maxTeams ?? null,
       parsed.startsAt ?? null, parsed.status ?? null, CLUB_ID]
    );

    await auditLog({
      clubId: CLUB_ID, userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.TOURNAMENT_UPDATED,
      entityType: 'tournament', entityId: req.params.id,
      newValues: { ...parsed },
    });

    res.json(rows[0]);
  } catch (err) { next(err); }
}

const registerSchema = z.object({
  teamName:     z.string().trim().min(2).max(100),
  contactPhone: z.string().trim().max(50).optional(),
});

// ── POST /api/tournaments/:id/teams ───────────────────────────
// Customers register their own team (they become captain); staff can enter
// walk-in teams with no captain account.
export async function registerTeam(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = registerSchema.parse(req.body);

    const { rows: tRows } = await db.query(
      `SELECT t.*, (SELECT COUNT(*) FROM tournament_teams WHERE tournament_id = t.id)::int AS team_count
       FROM tournaments t WHERE t.id = $1 AND t.club_id = $2`,
      [req.params.id, CLUB_ID]
    );
    if (!tRows.length) throw new NotFoundError('Tournament', req.params.id);
    const t = tRows[0];

    if (t.status !== 'registration_open') {
      throw new ValidationError('Registration is closed for this tournament');
    }
    if (t.team_count >= t.max_teams) {
      throw new ConflictError(`Tournament is full (${t.max_teams} teams)`);
    }

    const staff = isStaff(req.user!.role);
    if (!staff) {
      const { rows: mine } = await db.query(
        `SELECT id FROM tournament_teams WHERE tournament_id = $1 AND captain_id = $2`,
        [req.params.id, req.user!.sub]
      );
      if (mine.length) throw new ConflictError('You already registered a team for this tournament');
    }

    const { rows } = await db.query(
      `INSERT INTO tournament_teams (tournament_id, name, captain_id, contact_phone, amount_due)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, parsed.teamName, staff ? null : req.user!.sub,
       parsed.contactPhone ?? null, Number(t.registration_fee)]
    );

    await auditLog({
      clubId: CLUB_ID, userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.TOURNAMENT_TEAM_REGISTERED,
      entityType: 'tournament_team', entityId: rows[0].id,
      newValues: { tournamentId: req.params.id, teamName: parsed.teamName, amountDue: Number(t.registration_fee) },
    });

    res.status(201).json({
      ...rows[0],
      amount_due:  Number(rows[0].amount_due),
      amount_paid: Number(rows[0].amount_paid),
      payment_status: paymentStatus(Number(rows[0].amount_due), Number(rows[0].amount_paid)),
    });
  } catch (err) { next(err); }
}

const paySchema = z.object({
  amount: z.number().positive().optional(),          // staff may record partial payments
  method: z.enum(['INSTAPAY', 'VODAFONE_CASH', 'CASH', 'ONLINE']).default('ONLINE'),
});

// ── POST /api/tournaments/:id/teams/:teamId/pay ───────────────
// Customers settle their own team's remaining fee (online). Staff can record
// cash / InstaPay payments (partial or full) for any team.
export async function recordTeamPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = paySchema.parse(req.body);

    const { rows: teamRows } = await db.query(
      `SELECT tt.*, t.club_id, t.status AS tournament_status
       FROM tournament_teams tt
       JOIN tournaments t ON t.id = tt.tournament_id
       WHERE tt.id = $1 AND tt.tournament_id = $2 AND t.club_id = $3`,
      [req.params.teamId, req.params.id, CLUB_ID]
    );
    if (!teamRows.length) throw new NotFoundError('Team', req.params.teamId);
    const team = teamRows[0];

    const staff = isStaff(req.user!.role);
    if (!staff && team.captain_id !== req.user!.sub) {
      throw new ForbiddenError('You can only pay for your own team');
    }

    const due  = Number(team.amount_due);
    const paid = Number(team.amount_paid);
    const remaining = Math.max(due - paid, 0);
    if (remaining <= 0) throw new ConflictError('This team has already paid in full');

    // Customers always settle the full remaining balance online
    const amount = staff ? Math.min(parsed.amount ?? remaining, remaining) : remaining;
    const method = staff ? parsed.method : 'ONLINE';

    const { rows } = await db.query(
      `UPDATE tournament_teams
         SET amount_paid = amount_paid + $2,
             payment_method = $3,
             paid_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.teamId, amount, method]
    );

    await auditLog({
      clubId: CLUB_ID, userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.TOURNAMENT_FEE_RECORDED,
      entityType: 'tournament_team', entityId: req.params.teamId,
      previousValues: { amountPaid: paid },
      newValues: { amountPaid: Number(rows[0].amount_paid), amount, method },
    });

    res.json({
      ...rows[0],
      amount_due:  Number(rows[0].amount_due),
      amount_paid: Number(rows[0].amount_paid),
      payment_status: paymentStatus(Number(rows[0].amount_due), Number(rows[0].amount_paid)),
      message: `Recorded EGP ${amount.toLocaleString()} via ${method}`,
    });
  } catch (err) { next(err); }
}

/**
 * Standard bracket seed order for a power-of-two bracket, e.g. size 8 →
 * [1, 8, 4, 5, 2, 7, 3, 6]. Guarantees byes (seeds beyond the real team
 * count) land against the strongest seeds and spread across the draw.
 */
function bracketSeedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next: number[] = [];
    const opposite = order.length * 2 + 1;
    for (const s of order) next.push(s, opposite - s);
    order = next;
  }
  return order;
}

// ── POST /api/tournaments/:id/bracket (owner) ─────────────────
// Generates the full single-elimination tree from the registered teams,
// auto-advancing byes, and moves the tournament to in_progress.
export async function generateBracket(req: Request, res: Response, next: NextFunction): Promise<void> {
  const client = await db.connect();
  try {
    const { rows: tRows } = await client.query(
      `SELECT * FROM tournaments WHERE id = $1 AND club_id = $2 FOR UPDATE`,
      [req.params.id, CLUB_ID]
    );
    if (!tRows.length) throw new NotFoundError('Tournament', req.params.id);
    const t = tRows[0];
    if (t.status === 'completed' || t.status === 'cancelled') {
      throw new ValidationError(`Cannot generate a bracket for a ${t.status} tournament`);
    }

    const { rows: teams } = await client.query(
      `SELECT id, name FROM tournament_teams WHERE tournament_id = $1 ORDER BY created_at`,
      [req.params.id]
    );
    if (teams.length < 2) throw new ValidationError('At least 2 registered teams are required to generate a bracket');

    await client.query('BEGIN');

    // Regenerating replaces any previous draw
    await client.query(`DELETE FROM tournament_matches WHERE tournament_id = $1`, [req.params.id]);

    const size   = 2 ** Math.ceil(Math.log2(teams.length));
    const rounds = Math.log2(size);
    const seedOrder = bracketSeedOrder(size);

    // Persist seeds in registration order (team index + 1 = seed)
    for (let i = 0; i < teams.length; i++) {
      await client.query(`UPDATE tournament_teams SET seed = $2 WHERE id = $1`, [teams[i].id, i + 1]);
    }

    // Slot teams into the round-1 grid; seeds beyond teams.length are byes
    const slots: (string | null)[] = seedOrder.map((seed) => teams[seed - 1]?.id ?? null);

    // matchIds[round][position] so bye winners can be propagated immediately
    const matchIds: string[][] = [];
    for (let r = 1; r <= rounds; r++) {
      const count = size / 2 ** r;
      matchIds[r] = [];
      for (let p = 1; p <= count; p++) {
        const team1 = r === 1 ? slots[(p - 1) * 2]     : null;
        const team2 = r === 1 ? slots[(p - 1) * 2 + 1] : null;
        const { rows } = await client.query(
          `INSERT INTO tournament_matches (tournament_id, round, position, team1_id, team2_id)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [req.params.id, r, p, team1, team2]
        );
        matchIds[r][p] = rows[0].id;
      }
    }

    // Auto-advance round-1 byes into round 2
    if (rounds > 1) {
      for (let p = 1; p <= size / 2; p++) {
        const team1 = slots[(p - 1) * 2];
        const team2 = slots[(p - 1) * 2 + 1];
        if ((team1 === null) !== (team2 === null)) {
          const winner = team1 ?? team2;
          await client.query(
            `UPDATE tournament_matches SET winner_id = $2, played_at = NOW() WHERE id = $1`,
            [matchIds[1][p], winner]
          );
          const nextPos  = Math.ceil(p / 2);
          const nextSlot = p % 2 === 1 ? 'team1_id' : 'team2_id';
          await client.query(
            `UPDATE tournament_matches SET ${nextSlot} = $2 WHERE id = $1`,
            [matchIds[2][nextPos], winner]
          );
        }
      }
    }

    await client.query(
      `UPDATE tournaments SET status = 'in_progress', updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );

    await client.query('COMMIT');

    await auditLog({
      clubId: CLUB_ID, userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.TOURNAMENT_BRACKET_GENERATED,
      entityType: 'tournament', entityId: req.params.id,
      newValues: { teams: teams.length, bracketSize: size, rounds },
    });

    res.status(201).json({ message: `Bracket generated for ${teams.length} teams (${rounds} rounds)`, rounds, bracketSize: size });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

const resultSchema = z.object({
  winnerId: z.string().uuid(),
  score1:   z.number().int().min(0).max(999).optional(),
  score2:   z.number().int().min(0).max(999).optional(),
});

// ── PATCH /api/tournaments/:id/matches/:matchId (owner) ───────
// Records a match result and advances the winner up the tree. Recording the
// final's result completes the tournament.
export async function recordMatchResult(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = resultSchema.parse(req.body);

    const { rows: mRows } = await db.query(
      `SELECT m.* FROM tournament_matches m
       JOIN tournaments t ON t.id = m.tournament_id
       WHERE m.id = $1 AND m.tournament_id = $2 AND t.club_id = $3`,
      [req.params.matchId, req.params.id, CLUB_ID]
    );
    if (!mRows.length) throw new NotFoundError('Match', req.params.matchId);
    const match = mRows[0];

    if (!match.team1_id || !match.team2_id) {
      throw new ValidationError('Both teams must be decided before recording a result');
    }
    if (parsed.winnerId !== match.team1_id && parsed.winnerId !== match.team2_id) {
      throw new ValidationError('winnerId must be one of the two teams in this match');
    }

    await db.query(
      `UPDATE tournament_matches
         SET winner_id = $2, score1 = $3, score2 = $4, played_at = NOW()
       WHERE id = $1`,
      [req.params.matchId, parsed.winnerId, parsed.score1 ?? null, parsed.score2 ?? null]
    );

    // Advance the winner — or complete the tournament if this was the final
    const { rows: nextRows } = await db.query(
      `SELECT id FROM tournament_matches
       WHERE tournament_id = $1 AND round = $2 AND position = $3`,
      [req.params.id, match.round + 1, Math.ceil(match.position / 2)]
    );
    if (nextRows.length) {
      const nextSlot = match.position % 2 === 1 ? 'team1_id' : 'team2_id';
      await db.query(
        `UPDATE tournament_matches SET ${nextSlot} = $2 WHERE id = $1`,
        [nextRows[0].id, parsed.winnerId]
      );
    } else {
      await db.query(
        `UPDATE tournaments SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [req.params.id]
      );
    }

    await auditLog({
      clubId: CLUB_ID, userId: req.user!.sub, userRole: req.user!.role,
      ipAddress: req.ip, actionType: AUDIT_ACTIONS.TOURNAMENT_RESULT_RECORDED,
      entityType: 'tournament_match', entityId: req.params.matchId,
      newValues: { winnerId: parsed.winnerId, score1: parsed.score1, score2: parsed.score2 },
    });

    res.json({ message: 'Result recorded', final: nextRows.length === 0 });
  } catch (err) { next(err); }
}
