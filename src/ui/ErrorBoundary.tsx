import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Catches render and effect errors and shows what went wrong.
 *
 * The simulation core validates hard and throws on an impossible chain, which
 * is right for a headless physics library. But an error thrown from an effect
 * unmounts the whole tree, and the failure the user sees is a black screen with
 * nothing to act on. Showing the message and offering a way back is worth the
 * small amount of code.
 */
interface Props {
  readonly children: ReactNode
  /** Rebuilds a known-good state. */
  readonly onReset: () => void
}

interface State {
  readonly error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('simulation failed', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children

    return (
      <div className="crash">
        <h2>The simulation stopped</h2>
        <pre>{error.message}</pre>
        <p>
          This is usually a chain the physics cannot describe — a transverse chain
          with no tension, say, which has no restoring force at all rather than
          simply hanging still.
        </p>
        <button
          type="button"
          className="primary"
          onClick={() => {
            this.setState({ error: null })
            this.props.onReset()
          }}
        >
          reset to a working chain
        </button>
      </div>
    )
  }
}
