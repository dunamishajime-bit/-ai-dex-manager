import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from "qrcode";
import { UserProfile, saveUser } from "./user-store";

/**
 * TOTP (Google Authenticator)
 */

export async function generateTOTPSecret(email: string) {
    const secret = generateSecret();
    const otpauth = generateURI({ secret, label: email, issuer: "DIS-DEX" });
    const qrCodeUrl = await QRCode.toDataURL(otpauth);

    return { secret, qrCodeUrl };
}

export async function verifyTOTPToken(token: string, secret: string): Promise<boolean> {
    try {
        const result = await verify({ token, secret }) as any;
        return !!result?.valid;
    } catch (e) {
        return false;
    }
}

export function enableTOTP(user: UserProfile, secret: string): void {
    const updatedUser: UserProfile = {
        ...user,
        totpSecret: secret,
        isTotpEnabled: true
    };
    saveUser(updatedUser);
}

export function disableTOTP(user: UserProfile): void {
    const updatedUser: UserProfile = {
        ...user,
        totpSecret: undefined,
        isTotpEnabled: false
    };
    saveUser(updatedUser);
}

/**
 * WebAuthn / Passkeys (Placeholder for basic UI flow)
 * In a real Next.js app, this would involve complex challenge/response via API routes.
 */

export function registerPasskey(user: UserProfile, credential: any): void {
    const credentials = user.webAuthnCredentials || [];
    credentials.push(credential);

    const updatedUser: UserProfile = {
        ...user,
        webAuthnCredentials: credentials
    };
    saveUser(updatedUser);
}
