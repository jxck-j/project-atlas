import { Component, type ReactNode } from 'react'

interface Props {
  layerId: string
  children: ReactNode
}

interface State {
  hasError: boolean
}

// Isolates each layer's render tree so a broken layer (bad data, a bug in a
// future third-party-feeling module) can't take down the whole globe —
// error boundaries require a class component, there's no hook equivalent.
export class LayerErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.error(`[LayerEngine] layer "${this.props.layerId}" crashed and was disabled:`, error)
  }

  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}
