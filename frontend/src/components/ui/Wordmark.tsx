/** "AICA." with the orange dot, and "by BitNTech" in mono — the landing
 * page's mark, unchanged. */
export function Wordmark({ by = true }: { by?: boolean }) {
  return (
    <span className="wordmark">
      <span className="wordmark__word">
        AICA<i>.</i>
      </span>
      {by && (
        <span className="wordmark__by">
          by BitN<em>Tech</em>
        </span>
      )}
    </span>
  )
}
