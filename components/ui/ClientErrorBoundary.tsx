"use client";

import React from "react";

type ClientErrorBoundaryProps = {
    children: React.ReactNode;
    label?: string;
};

type ClientErrorBoundaryState = {
    hasError: boolean;
};

export class ClientErrorBoundary extends React.Component<ClientErrorBoundaryProps, ClientErrorBoundaryState> {
    state: ClientErrorBoundaryState = {
        hasError: false,
    };

    static getDerivedStateFromError(): ClientErrorBoundaryState {
        return { hasError: true };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error(`[ClientErrorBoundary:${this.props.label || "unknown"}]`, error, errorInfo);
    }

    private handleReload = () => {
        if (typeof window !== "undefined") {
            window.location.reload();
        }
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="m-4 rounded-xl border border-red-500/30 bg-[#120b0b] p-5 text-white shadow-[0_0_30px_rgba(127,29,29,0.2)]">
                    <div className="text-sm font-bold text-red-400">
                        UI section failed: {this.props.label || "unknown"}
                    </div>
                    <p className="mt-2 text-sm text-gray-300">
                        The page is still running, but this section was disabled after a client-side error.
                    </p>
                    <button
                        onClick={this.handleReload}
                        className="mt-4 rounded border border-gold-500/30 bg-gold-500/10 px-3 py-2 text-xs font-bold text-gold-300 transition-colors hover:bg-gold-500/20"
                    >
                        Reload page
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
