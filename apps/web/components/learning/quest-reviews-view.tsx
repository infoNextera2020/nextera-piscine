'use client';

import { useState, useEffect } from 'react';
import s from './challenge.module.css';

type Assignment = {
  assignment_id: string;
  cycle_id: string;
  cohort_id: string;
  quest_key: string;
  learner_id: string;
  kind: 'peer' | 'mentor';
  assigned_at_ms: number;
  question_ids: string[];
  learner_name: string;
  existing_decision?: string | null;
};

type OwnCycle = {
  cycle_id: string;
  cohort_id: string;
  quest_key: string;
  question_ids: string[];
  recorded_at: string;
  peer_receipts_count: number;
  mentor_verdict?: string | null;
};

export function QuestReviewsView({ role, defaultCohortId }: { role: string; defaultCohortId?: string | undefined }) {
  const [assignedReviews, setAssignedReviews] = useState<Assignment[]>([]);
  const [ownCycles, setOwnCycles] = useState<OwnCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  async function loadReviews() {
    setLoading(true);
    try {
      const url = defaultCohortId ? `/api/quest-reviews?cohortId=${defaultCohortId}` : '/api/quest-reviews';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setAssignedReviews(data.assignedReviews || []);
        setOwnCycles(data.ownCycles || []);
      }
    } catch (err) {
      console.error('Failed to load reviews:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReviews();
  }, [defaultCohortId]);

  async function handleSubmitReview(
    assignment: Assignment,
    decision: 'submitted' | 'approved' | 'changes_requested'
  ) {
    setSubmittingId(assignment.assignment_id);
    setActionMessage(null);
    try {
      const res = await fetch('/api/quest-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit',
          cohortId: assignment.cohort_id,
          questKey: assignment.quest_key,
          learnerId: assignment.learner_id,
          cycleId: assignment.cycle_id,
          assignmentId: assignment.assignment_id,
          decision,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        const msg =
          decision === 'approved'
            ? `Review approved successfully! ${data.masteryRecorded ? 'Mastery recorded in student progress.' : ''}`
            : decision === 'submitted'
            ? 'Peer review submitted successfully!'
            : 'Changes requested recorded.';
        setActionMessage(msg);
        await loadReviews();
      } else {
        setActionMessage(`Failed: ${data.error || 'Server error'}`);
      }
    } catch (err: any) {
      setActionMessage(`Error: ${err.message || 'Request failed'}`);
    } finally {
      setSubmittingId(null);
    }
  }

  if (loading) {
    return <div style={{ padding: '2rem', color: '#888' }}>Loading quest reviews...</div>;
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto', color: '#fff' }}>
      <h1 style={{ fontSize: '1.8rem', fontWeight: 600, marginBottom: '0.5rem' }}>Quest Reviews</h1>
      <p style={{ color: '#aaa', marginBottom: '2rem' }}>
        Peer and Mentor review management for 01 coding Piscine quests.
      </p>

      {actionMessage && (
        <div
          id="review-action-message"
          style={{
            padding: '1rem',
            marginBottom: '1.5rem',
            borderRadius: '6px',
            backgroundColor: actionMessage.includes('Failed') || actionMessage.includes('Error') ? '#381214' : '#12381f',
            border: `1px solid ${actionMessage.includes('Failed') || actionMessage.includes('Error') ? '#ff4d4f' : '#52c41a'}`,
            color: '#fff',
          }}
        >
          {actionMessage}
        </div>
      )}

      {/* 1. Assigned Reviews for this user */}
      <section style={{ marginBottom: '3rem' }}>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: '1rem', borderBottom: '1px solid #333', paddingBottom: '0.5rem' }}>
          Assigned to You for Review ({assignedReviews.length})
        </h2>

        {assignedReviews.length === 0 ? (
          <p style={{ color: '#777' }}>You have no pending reviews assigned at this time.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {assignedReviews.map((a) => {
              const isSubmitting = submittingId === a.assignment_id;
              const completed = Boolean(a.existing_decision);

              return (
                <div
                  key={a.assignment_id}
                  data-assignment-id={a.assignment_id}
                  style={{
                    padding: '1.25rem',
                    borderRadius: '8px',
                    backgroundColor: '#18181b',
                    border: '1px solid #27272a',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <div>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          textTransform: 'uppercase',
                          fontWeight: 700,
                          backgroundColor: a.kind === 'peer' ? '#1e3a8a' : '#581c87',
                          color: a.kind === 'peer' ? '#93c5fd' : '#e9d5ff',
                          marginRight: '0.5rem',
                        }}
                      >
                        {a.kind} review
                      </span>
                      <strong style={{ fontSize: '1.1rem' }}>{a.quest_key.toUpperCase()}</strong>
                    </div>
                    <div>
                      {completed ? (
                        <span style={{ color: '#4ade80', fontWeight: 600 }}>Decision: {a.existing_decision}</span>
                      ) : (
                        <span style={{ color: '#facc15' }}>Pending Action</span>
                      )}
                    </div>
                  </div>

                  <p style={{ margin: '0.25rem 0', color: '#ccc' }}>
                    Learner: <strong>{a.learner_name}</strong>
                  </p>

                  <div style={{ margin: '0.75rem 0' }}>
                    <p style={{ fontSize: '0.85rem', color: '#888', marginBottom: '0.25rem' }}>
                      Review Rubric Questions:
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {a.question_ids?.map((qid) => (
                        <span
                          key={qid}
                          style={{
                            fontSize: '0.8rem',
                            backgroundColor: '#27272a',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '4px',
                            color: '#e4e4e7',
                          }}
                        >
                          {qid}
                        </span>
                      ))}
                    </div>
                  </div>

                  {!completed && (
                    <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
                      {a.kind === 'peer' ? (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => handleSubmitReview(a, 'submitted')}
                          style={{
                            padding: '0.5rem 1rem',
                            backgroundColor: '#2563eb',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontWeight: 600,
                          }}
                        >
                          {isSubmitting ? 'Submitting...' : 'Submit Peer Review (Complete)'}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => handleSubmitReview(a, 'approved')}
                            style={{
                              padding: '0.5rem 1rem',
                              backgroundColor: '#16a34a',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontWeight: 600,
                            }}
                          >
                            {isSubmitting ? 'Recording...' : 'Approve (Mark Mastered)'}
                          </button>
                          <button
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => handleSubmitReview(a, 'changes_requested')}
                            style={{
                              padding: '0.5rem 1rem',
                              backgroundColor: '#dc2626',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontWeight: 600,
                            }}
                          >
                            {isSubmitting ? 'Submitting...' : 'Request Changes'}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 2. Learner's own review cycles */}
      {role === 'learner' && (
        <section>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: '1rem', borderBottom: '1px solid #333', paddingBottom: '0.5rem' }}>
            Your Quest Review Status ({ownCycles.length})
          </h2>

          {ownCycles.length === 0 ? (
            <p style={{ color: '#777' }}>You have not initiated any quest reviews yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {ownCycles.map((c) => (
                <div
                  key={c.cycle_id}
                  style={{
                    padding: '1.25rem',
                    borderRadius: '8px',
                    backgroundColor: '#18181b',
                    border: '1px solid #27272a',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '1.1rem' }}>{c.quest_key.toUpperCase()}</strong>
                    <div>
                      {c.mentor_verdict === 'approved' ? (
                        <span style={{ color: '#4ade80', fontWeight: 700 }}>✓ MASTERED (Approved by Mentor)</span>
                      ) : c.mentor_verdict === 'changes_requested' ? (
                        <span style={{ color: '#f87171', fontWeight: 600 }}>Changes Requested</span>
                      ) : c.peer_receipts_count > 0 ? (
                        <span style={{ color: '#60a5fa' }}>Peer Completed ({c.peer_receipts_count}/1) · Waiting Mentor</span>
                      ) : (
                        <span style={{ color: '#facc15' }}>Waiting for Peer Review</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
