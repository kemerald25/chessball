// ============================================================================
// FILE 4: app/api/zealy/verify/route.ts
// Called BY ZEALY when user tries to claim a quest
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient } from '@/lib/supabase';

const ZEALY_API_KEY = process.env.ZEALY_API_KEY || "eb50c37i_YJBlFllX6ojkZycqFd";

export async function POST(req: NextRequest) {
  try {
    // Verify API key from Zealy
    const apiKey = req.headers.get('x-api-key');
    if (apiKey !== ZEALY_API_KEY) {
      console.error('Invalid API key received');
      return NextResponse.json({
        message: 'Invalid API key'
      }, { status: 400 });
    }

    const body = await req.json();
    const {
      userId,           // Zealy user ID
      communityId,      
      subdomain,        
      questId,          
      requestId,        
      accounts
    } = body;

    // Get the Zealy Connect identifier (wallet address)
    const zealyConnectIdentifier = accounts?.['zealy-connect'];
    
    if (!zealyConnectIdentifier) {
      return NextResponse.json({
        message: 'Account not connected. Please connect your ChessBall account first by clicking the Connect button in the quest!'
      }, { status: 400 });
    }

    const supabase = createAnonClient();
    
    const { data: team, error } = await supabase
      .from('teams')
      .select('id, name, coach_wallet_address, zealy_user_id')
      .eq('coach_wallet_address', zealyConnectIdentifier)
      .maybeSingle();

    if (error) {
      console.error('Database error:', error, 'RequestID:', requestId);
      return NextResponse.json({
        message: `Database error occurred. Please contact support with Request ID: ${requestId}`
      }, { status: 400 });
    }

    if (!team) {
      return NextResponse.json({
        message: `No ChessBall team found for this account. Please create a team at play.chessball.fun first!`
      }, { status: 400 });
    }

    // Verify the Zealy user ID matches
    if (team.zealy_user_id && team.zealy_user_id !== userId) {
      return NextResponse.json({
        message: `Account mismatch detected. Please reconnect your account.`
      }, { status: 400 });
    }

    // Quest completed successfully!
    return NextResponse.json({
      message: `✅ Quest completed! Welcome, Team ${team.name}!`
    }, { status: 200 });

  } catch (error: any) {
    console.error('Unexpected error in Zealy verification:', error);
    return NextResponse.json({
      message: 'An unexpected error occurred. Please try again later.'
    }, { status: 400 });
  }
}