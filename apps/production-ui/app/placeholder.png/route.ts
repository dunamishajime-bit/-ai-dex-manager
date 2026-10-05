import { NextResponse } from "next/server";

const ONE_PIXEL_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2NkYGD4DwABBAEAgr2XswAAAABJRU5ErkJggg==";

export function GET() {
    const body = Buffer.from(ONE_PIXEL_PNG_BASE64, "base64");

    return new NextResponse(body, {
        headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    });
}
