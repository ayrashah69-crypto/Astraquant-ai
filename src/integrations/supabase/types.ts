export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_signals: {
        Row: {
          action: string
          confidence: number
          created_at: string
          features: Json
          id: string
          price: number
          rationale: string | null
          risk_check: Json
          strategy: string
          symbol: string
          user_id: string
        }
        Insert: {
          action: string
          confidence: number
          created_at?: string
          features?: Json
          id?: string
          price: number
          rationale?: string | null
          risk_check?: Json
          strategy: string
          symbol: string
          user_id: string
        }
        Update: {
          action?: string
          confidence?: number
          created_at?: string
          features?: Json
          id?: string
          price?: number
          rationale?: string | null
          risk_check?: Json
          strategy?: string
          symbol?: string
          user_id?: string
        }
        Relationships: []
      }
      backtest_runs: {
        Row: {
          created_at: string
          data_source: string
          end_date: string
          equity_curve: Json
          final_equity: number
          id: string
          losses: number
          max_drawdown_pct: number
          start_date: string
          starting_capital: number
          strategy: string
          symbol: string
          total_return_pct: number
          total_trades: number
          user_id: string
          win_rate: number
          wins: number
        }
        Insert: {
          created_at?: string
          data_source?: string
          end_date: string
          equity_curve: Json
          final_equity: number
          id?: string
          losses: number
          max_drawdown_pct: number
          start_date: string
          starting_capital: number
          strategy: string
          symbol: string
          total_return_pct: number
          total_trades: number
          user_id: string
          win_rate: number
          wins: number
        }
        Update: {
          created_at?: string
          data_source?: string
          end_date?: string
          equity_curve?: Json
          final_equity?: number
          id?: string
          losses?: number
          max_drawdown_pct?: number
          start_date?: string
          starting_capital?: number
          strategy?: string
          symbol?: string
          total_return_pct?: number
          total_trades?: number
          user_id?: string
          win_rate?: number
          wins?: number
        }
        Relationships: []
      }
      licenses: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          license_key: string
          plan: Database["public"]["Enums"]["license_plan"]
          status: Database["public"]["Enums"]["license_status"]
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          license_key: string
          plan: Database["public"]["Enums"]["license_plan"]
          status?: Database["public"]["Enums"]["license_status"]
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          license_key?: string
          plan?: Database["public"]["Enums"]["license_plan"]
          status?: Database["public"]["Enums"]["license_status"]
          user_id?: string
        }
        Relationships: []
      }
      market_data: {
        Row: {
          close: number
          high: number
          low: number
          open: number
          symbol: string
          ts: string
          source: string
          volume: number | null
        }
        Insert: {
          close: number
          high: number
          low: number
          open: number
          symbol: string
          ts: string
          source?: string
          volume?: number | null
        }
        Update: {
          close?: number
          high?: number
          low?: number
          open?: number
          symbol?: string
          ts?: string
          source?: string
          volume?: number | null
        }
        Relationships: []
      }
      portfolios: {
        Row: {
          cash_balance: number
          created_at: string
          id: string
          realized_pnl: number
          starting_balance: number
          updated_at: string
          user_id: string
        }
        Insert: {
          cash_balance?: number
          created_at?: string
          id?: string
          realized_pnl?: number
          starting_balance?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          cash_balance?: number
          created_at?: string
          id?: string
          realized_pnl?: number
          starting_balance?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      positions: {
        Row: {
          avg_price: number
          id: string
          opened_at: string
          portfolio_id: string
          quantity: number
          symbol: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_price: number
          id?: string
          opened_at?: string
          portfolio_id: string
          quantity: number
          symbol: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_price?: number
          id?: string
          opened_at?: string
          portfolio_id?: string
          quantity?: number
          symbol?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "positions_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          max_position_pct: number
          risk_per_trade: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          max_position_pct?: number
          risk_per_trade?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          max_position_pct?: number
          risk_per_trade?: number
          updated_at?: string
        }
        Relationships: []
      }
      trades: {
        Row: {
          equity_after: number | null
          executed_at: string
          id: string
          notional: number
          portfolio_id: string
          price: number
          quantity: number
          realized_pnl: number
          side: string
          signal_id: string | null
          source: string
          symbol: string
          user_id: string
        }
        Insert: {
          equity_after?: number | null
          executed_at?: string
          id?: string
          notional: number
          portfolio_id: string
          price: number
          quantity: number
          realized_pnl?: number
          side: string
          signal_id?: string | null
          source?: string
          symbol: string
          user_id: string
        }
        Update: {
          equity_after?: number | null
          executed_at?: string
          id?: string
          notional?: number
          portfolio_id?: string
          price?: number
          quantity?: number
          realized_pnl?: number
          side?: string
          signal_id?: string | null
          source?: string
          symbol?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trades_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_license_key: {
        Args: { _plan: Database["public"]["Enums"]["license_plan"] }
        Returns: string
      }
      execute_paper_trade: {
        Args: {
          _user_id: string
          _symbol: string
          _side: string
          _quantity: number
          _price: number
          _fee_rate: number
          _source: string
          _signal_id: string | null
        }
        Returns: {
          trade_id: string
          fill_price: number
          fill_quantity: number
          realized_pnl: number
          cash_after: number
        }[]
      }
    }
    Enums: {
      license_plan: "demo" | "pro" | "enterprise"
      license_status: "active" | "expired" | "revoked"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      license_plan: ["demo", "pro", "enterprise"],
      license_status: ["active", "expired", "revoked"],
    },
  },
} as const
