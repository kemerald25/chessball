"use client";

import { useMiniKit } from "@coinbase/onchainkit/minikit";
import { ConnectWallet, Wallet, WalletDropdown, WalletDropdownDisconnect } from "@coinbase/onchainkit/wallet";
import { Name, Identity, Address, Avatar, EthBalance } from "@coinbase/onchainkit/identity";
import { useAccount, useSignMessage } from "wagmi";
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import crypto from 'crypto';
import { authUserWithSignature } from '@/lib/auth';

const ZEALY_COMMUNITY_SECRET = process.env.NEXT_PUBLIC_ZEALY_COMMUNITY_SECRET || "bf4227ba5e04c8c2a1c8be09d53232caed908783200f882133776aeaab6edbfc";
const ZEALY_SUBDOMAIN = "chessballtacticians"; // UPDATE THIS to your actual Zealy subdomain

export default function ConnectZealyPage() {
    const { setFrameReady, isFrameReady, context } = useMiniKit();
    const { address, isConnected } = useAccount();
    const { signMessageAsync } = useSignMessage();
    const searchParams = useSearchParams();

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [isLinked, setIsLinked] = useState<boolean | null>(null);

    // Zealy parameters
    const zealyUserId = searchParams.get('zealyUserId');
    const callbackUrl = searchParams.get('callback');
    const zealySignature = searchParams.get('signature');

    const isMiniApp = useMemo(() => {
        return context !== null && context !== undefined;
    }, [context]);

    const verifyZealySignature = useCallback((url: string, signature: string | null) => {
        if (!signature) return false;

        try {
            const fullUrl = new URL(url);
            fullUrl.searchParams.delete("signature");

            const hmac = crypto.createHmac("sha256", ZEALY_COMMUNITY_SECRET);
            hmac.update(fullUrl.toString());
            const generatedSignature = hmac.digest("hex");

            return generatedSignature === signature;
        } catch (err) {
            console.error("Error verifying signature:", err);
            return false;
        }
    }, []);

    const generateCallbackSignature = useCallback((url: string, identifier: string) => {
        const callbackWithParams = new URL(url);
        callbackWithParams.searchParams.append("identifier", identifier);

        const hmac = crypto.createHmac("sha256", ZEALY_COMMUNITY_SECRET);
        hmac.update(callbackWithParams.toString());
        return hmac.digest("hex");
    }, []);

    const handleZealyConnect = useCallback(async () => {
        if (!address || !zealyUserId || !callbackUrl) {
            setError("Missing required parameters");
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const authSignature = await authUserWithSignature(address, signMessageAsync);
            if (!authSignature) {
                throw new Error("Failed to authenticate wallet");
            }

            const response = await fetch('/api/link-zealy-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    walletAddress: address,
                    zealyUserId: zealyUserId,
                    signature: authSignature.signature,
                    message: authSignature.message,
                }),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || "Failed to link account");
            }

            setSuccess(true);

            const platformUserId = address;
            const newSignature = generateCallbackSignature(callbackUrl, platformUserId);

            const finalCallbackUrl = new URL(callbackUrl);
            finalCallbackUrl.searchParams.append("identifier", platformUserId);
            finalCallbackUrl.searchParams.append("signature", newSignature);

            setTimeout(() => {
                window.location.href = finalCallbackUrl.toString();
            }, 1500);

        } catch (err: any) {
            console.error("Zealy Connect error:", err);
            setError(err.message || "Failed to connect account");
        } finally {
            setIsLoading(false);
        }
    }, [address, zealyUserId, callbackUrl, signMessageAsync, generateCallbackSignature]);

    const handleInitiateZealyConnect = useCallback(() => {
        if (typeof window === 'undefined') return;
        
        setIsLoading(true);
        const callbackUrlEncoded = encodeURIComponent(`${window.location.origin}/connect-zealy`);
        const zealyConnectUrl = `https://zealy.io/cw/chessballtacticians/questboard/6c7f2fea-1c0e-40e0-98a8-ad0bb7621304/84f0cad9-9866-4116-8abf-c28d50e86a16`;
        
        window.location.href = zealyConnectUrl;
    }, []);

    // Check if already linked
    useEffect(() => {
        const checkLink = async () => {
            if (!address) return;
            
            try {
                const response = await fetch('/api/check-zealy-link', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ walletAddress: address }),
                });
                
                const data = await response.json();
                setIsLinked(data.isLinked);
            } catch (err) {
                console.error('Error checking Zealy link:', err);
            }
        };

        if (!zealyUserId && !callbackUrl) {
            checkLink();
        }
    }, [address, zealyUserId, callbackUrl]);

    useEffect(() => {
        if (zealyUserId && callbackUrl && zealySignature) {
            if (typeof window !== 'undefined') {
                const currentUrl = window.location.href;
                if (!verifyZealySignature(currentUrl, zealySignature)) {
                    setError("Invalid Zealy signature");
                    return;
                }
            }
        }
    }, [zealyUserId, callbackUrl, zealySignature, verifyZealySignature]);

    useEffect(() => {
        if (isConnected && address && zealyUserId && callbackUrl && !success && !isLoading && !error) {
            handleZealyConnect();
        }
    }, [isConnected, address, zealyUserId, callbackUrl, success, isLoading, error, handleZealyConnect]);

    useEffect(() => {
        if (!isFrameReady) {
            setFrameReady();
        }
    }, [setFrameReady, isFrameReady]);

    const zealyConnectUrl = useMemo(() => {
        if (typeof window === 'undefined') return '';
        const currentPath = window.location.pathname + window.location.search;
        return `base://app.minikit.frames.coinbase.com/${encodeURIComponent(window.location.origin + currentPath)}`;
    }, []);

    // MODE 1: Direct access (no Zealy params) - Show "Connect to Zealy" button
    if (!zealyUserId || !callbackUrl) {
        return (
            <div className="min-h-screen w-full flex flex-col items-center p-4 font-sans bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100">
                <div className="absolute top-4 right-4 z-20">
                    <Wallet>
                        <ConnectWallet className="bg-black text-white px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors shadow-md">
                            <Name className="text-white" />
                        </ConnectWallet>
                        <WalletDropdown>
                            <Identity className="px-4 pt-3 pb-2" hasCopyAddressOnClick>
                                <Avatar />
                                <Name />
                                <Address />
                                <EthBalance />
                            </Identity>
                            <WalletDropdownDisconnect />
                        </WalletDropdown>
                    </Wallet>
                </div>

                <div className="w-full flex justify-center items-center mb-8 mt-8">
                    <div className="flex flex-col items-center">
                        <img src="/logo-white.png" alt="ChessBall Logo" className="h-32" />
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent mt-4">
                            Connect to Zealy
                        </h1>
                    </div>
                </div>

                <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-gray-200 p-8">
                    <div className="text-center">
                        {!isConnected ? (
                            <React.Fragment>
                                <div className="text-6xl mb-4">👋</div>
                                <h3 className="text-xl font-semibold text-gray-800 mb-3">Welcome!</h3>
                                <p className="text-gray-600 mb-6 text-sm">
                                    Connect your wallet to link your ChessBall account with Zealy and start earning rewards.
                                </p>
                                <ConnectWallet className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 px-6 py-3 rounded-lg text-white font-medium text-lg shadow-md transition-all">
                                    Connect Wallet
                                </ConnectWallet>
                            </React.Fragment>
                        ) : isLinked ? (
                            <React.Fragment>
                                <div className="text-6xl mb-4">✅</div>
                                <h3 className="text-xl font-semibold text-gray-800 mb-3">Already Connected!</h3>
                                <p className="text-gray-600 text-sm mb-4">
                                    Your ChessBall account is already linked to Zealy.
                                </p>
                                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                                    <p className="text-sm text-green-700">
                                        You can now complete quests and earn rewards on Zealy!
                                    </p>
                                </div>
                            </React.Fragment>
                        ) : (
                            <React.Fragment>
                                <div className="text-6xl mb-4">🏆</div>
                                <h3 className="text-xl font-semibold text-gray-800 mb-3">Link with Zealy</h3>
                                <p className="text-gray-600 mb-6 text-sm">
                                    Connect your ChessBall account with Zealy to complete quests and earn rewards!
                                </p>
                                <button
                                    onClick={handleInitiateZealyConnect}
                                    disabled={isLoading}
                                    className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-semibold py-3 px-6 rounded-lg transition-all shadow-md flex items-center justify-center gap-2"
                                >
                                    <span>🏆</span>
                                    <span>Go to Zealy Quests</span>
                                </button>
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-4">
                                    <p className="text-xs text-blue-700">
                                        Visit our Zealy quests and click "Connect Account" on any quest to link your ChessBall wallet.
                                    </p>
                                </div>
                            </React.Fragment>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // MODE 2: Callback from Zealy (has params) - Original flow
    return (
        <div className="min-h-screen w-full flex flex-col items-center p-4 font-sans bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100">
            <div className="absolute top-4 right-4 z-20">
                <Wallet>
                    <ConnectWallet className="bg-black text-white px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors shadow-md">
                        <Name className="text-white" />
                    </ConnectWallet>
                    <WalletDropdown>
                        <Identity className="px-4 pt-3 pb-2" hasCopyAddressOnClick>
                            <Avatar />
                            <Name />
                            <Address />
                            <EthBalance />
                        </Identity>
                        <WalletDropdownDisconnect />
                    </WalletDropdown>
                </Wallet>
            </div>

            <div className="w-full flex justify-center items-center mb-8 mt-8">
                <div className="flex flex-col items-center">
                    <img src="/logo-white.png" alt="ChessBall Logo" className="h-32" />
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent mt-4">
                        Connect to Zealy
                    </h1>
                </div>
            </div>

            <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-gray-200 p-8">
                {!isMiniApp && (
                    <div className="bg-yellow-50 border-l-4 border-yellow-400 text-yellow-800 p-4 mb-6 rounded-r">
                        <p className="font-bold mb-2">⚠️ Open in Base Mini-App</p>
                        <p className="text-sm mb-3">For the best experience, open this in the Base Mini-App.</p>

                        <a href={zealyConnectUrl}
                            className="inline-block bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-semibold px-4 py-2 rounded transition-colors text-sm">
                            Open in Mini-App
                        </a>
                    </div>
                )}

                <div className="text-center">
                    {success ? (
                        <React.Fragment>
                            <div className="text-6xl mb-4">✅</div>
                            <h3 className="text-xl font-semibold text-gray-800 mb-3">Connected!</h3>
                            <p className="text-gray-600 text-sm">Redirecting back to Zealy...</p>
                        </React.Fragment>
                    ) : error ? (
                        <React.Fragment>
                            <div className="text-6xl mb-4">❌</div>
                            <h3 className="text-xl font-semibold text-gray-800 mb-3">Connection Failed</h3>
                            <p className="text-red-600 text-sm mb-4">{error}</p>
                            <button
                                onClick={() => window.location.reload()}
                                className="text-blue-600 hover:text-blue-700 text-sm underline"
                            >
                                Try Again
                            </button>
                        </React.Fragment>
                    ) : isConnected && address ? (
                        <React.Fragment>
                            <div className="text-6xl mb-4">🔗</div>
                            <h3 className="text-xl font-semibold text-gray-800 mb-3">Connecting...</h3>
                            <div className="flex justify-center">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
                            </div>
                        </React.Fragment>
                    ) : (
                        <React.Fragment>
                            <div className="text-6xl mb-4">👋</div>
                            <h3 className="text-xl font-semibold text-gray-800 mb-3">Connect Your Wallet</h3>
                            <p className="text-gray-600 mb-6 text-sm">
                                Connect your wallet to link your ChessBall account with Zealy.
                            </p>
                            <ConnectWallet className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 px-6 py-3 rounded-lg text-white font-medium text-lg shadow-md transition-all">
                                Connect Wallet
                            </ConnectWallet>
                        </React.Fragment>
                    )}
                </div>
            </div>
        </div>
    );
}