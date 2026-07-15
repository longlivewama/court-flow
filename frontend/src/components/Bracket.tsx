'use client';

/**
 * Interactive single-elimination bracket tree.
 *
 * Read-only for clients; when `canRecord` is set (owner), undecided matches
 * with both slots filled expose an inline result editor (winner + scores).
 */
import { useState } from 'react';
import { Trophy } from 'lucide-react';

export interface BracketMatch {
  id:        string;
  round:     number;
  position:  number;
  team1_id:  string | null;
  team2_id:  string | null;
  winner_id: string | null;
  score1:    number | null;
  score2:    number | null;
}

interface BracketProps {
  matches:   BracketMatch[];
  teamNames: Record<string, string>;
  canRecord?: boolean;
  onRecord?: (matchId: string, winnerId: string, score1?: number, score2?: number) => Promise<void>;
}

function roundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  return `Round of ${2 ** (fromEnd + 1)}`;
}

export function Bracket({ matches, teamNames, canRecord = false, onRecord }: BracketProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [scores, setScores]   = useState<{ s1: string; s2: string }>({ s1: '', s2: '' });
  const [saving, setSaving]   = useState(false);

  if (!matches.length) return null;

  const totalRounds = Math.max(...matches.map((m) => m.round));
  const rounds: BracketMatch[][] = [];
  for (let r = 1; r <= totalRounds; r++) {
    rounds.push(matches.filter((m) => m.round === r).sort((a, b) => a.position - b.position));
  }

  async function record(match: BracketMatch, winnerId: string) {
    if (!onRecord || saving) return;
    setSaving(true);
    try {
      const s1 = scores.s1 === '' ? undefined : Number(scores.s1);
      const s2 = scores.s2 === '' ? undefined : Number(scores.s2);
      await onRecord(match.id, winnerId, s1, s2);
      setEditing(null);
      setScores({ s1: '', s2: '' });
    } finally {
      setSaving(false);
    }
  }

  function teamRow(match: BracketMatch, teamId: string | null, slot: 1 | 2) {
    const name    = teamId ? teamNames[teamId] ?? 'Unknown team' : 'TBD';
    const decided = !!match.winner_id;
    const isWinner = decided && match.winner_id === teamId;
    const score   = slot === 1 ? match.score1 : match.score2;
    const editable = canRecord && !decided && !!match.team1_id && !!match.team2_id && editing === match.id;

    return (
      <div
        className={`bracket-team ${isWinner ? 'winner' : ''} ${!teamId ? 'tbd' : ''}`}
        style={editable ? { cursor: 'pointer' } : undefined}
        role={editable ? 'button' : undefined}
        tabIndex={editable ? 0 : undefined}
        title={editable ? `Declare ${name} the winner` : undefined}
        onClick={editable && teamId ? () => record(match, teamId) : undefined}
        onKeyDown={editable && teamId ? (e) => { if (e.key === 'Enter') record(match, teamId); } : undefined}
      >
        <span className="truncate" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {isWinner && <Trophy size={11} style={{ flexShrink: 0 }} />}
          {name}
        </span>
        {score !== null ? (
          <span className="bracket-score">{score}</span>
        ) : editable ? (
          <input
            className="input"
            type="number"
            min={0}
            style={{ width: 44, height: 22, fontSize: 11, padding: '0 6px' }}
            value={slot === 1 ? scores.s1 : scores.s2}
            placeholder="—"
            aria-label={`${name} score`}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setScores((s) => (slot === 1 ? { ...s, s1: e.target.value } : { ...s, s2: e.target.value }))}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="bracket" role="tree" aria-label="Tournament bracket">
      {rounds.map((roundMatches, i) => (
        <div key={i} className="bracket-round">
          <div>
            <div className="bracket-round-label">{roundLabel(i + 1, totalRounds)}</div>
          </div>
          {roundMatches.map((match) => {
            const playable = canRecord && !match.winner_id && !!match.team1_id && !!match.team2_id;
            return (
              <div key={match.id}>
                <div className={`bracket-match ${match.winner_id ? 'decided' : ''}`}>
                  {teamRow(match, match.team1_id, 1)}
                  {teamRow(match, match.team2_id, 2)}
                </div>
                {playable && (
                  <div style={{ textAlign: 'center', marginTop: 4 }}>
                    {editing === match.id ? (
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        {saving ? 'Saving…' : 'Enter scores, then click the winner ·'}{' '}
                        <button className="btn btn-ghost btn-sm" style={{ height: 20, padding: '0 6px', fontSize: 11 }}
                          onClick={() => { setEditing(null); setScores({ s1: '', s2: '' }); }}>
                          cancel
                        </button>
                      </span>
                    ) : (
                      <button className="btn btn-secondary btn-sm" style={{ height: 22, fontSize: 11 }}
                        onClick={() => { setEditing(match.id); setScores({ s1: '', s2: '' }); }}>
                        Record result
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
