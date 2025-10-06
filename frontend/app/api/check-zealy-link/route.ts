// ============================================================================
// FILE 2: app/api/check-zealy-link/route.ts
// Check if a wallet already has Zealy linked
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const { walletAddress } = await req.json();

    if (!walletAddress) {
      return NextResponse.json({ 
        isLinked: false,
        error: 'No wallet address provided' 
      }, { status: 400 });
    }

    const supabase = createAnonClient();

    const { data: team, error } = await supabase
      .from('teams')
      .select('zealy_user_id')
      .eq('coach_wallet_address', walletAddress)
      .maybeSingle();

    if (error) {
      console.error('Error checking Zealy link:', error);
      return NextResponse.json({ 
        isLinked: false,
        error: 'Database error' 
      }, { status: 500 });
    }

    return NextResponse.json({ 
      isLinked: !!(team && team.zealy_user_id),
      zealyUserId: team?.zealy_user_id || null
    }, { status: 200 });

  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ 
      isLinked: false,
      error: 'Internal server error' 
    }, { status: 500 });
  }
}