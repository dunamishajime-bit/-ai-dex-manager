"use client";

import React from "react";

type Props = {
    children: React.ReactNode;
    fallback: React.ReactNode;
};

type State = {
    hasError: boolean;
};

export class ClientErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: unknown) {
        console.error("[ClientErrorBoundary]", error);
    }

    render() {
        if (this.state.hasError) {
            return this.props.fallback;
        }
        return this.props.children;
    }
}
