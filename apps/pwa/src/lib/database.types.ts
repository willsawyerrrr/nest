export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_balance: {
        Row: {
          account_id: string
          balance_cents: number
          household_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          account_id: string
          balance_cents?: number
          household_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          balance_cents?: number
          household_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'account_balance_account_id_fkey'
            columns: ['account_id']
            isOneToOne: true
            referencedRelation: 'account_directory'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'account_balance_account_id_fkey'
            columns: ['account_id']
            isOneToOne: true
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'account_balance_account_id_fkey'
            columns: ['account_id']
            isOneToOne: true
            referencedRelation: 'accounts_with_balance'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'account_balance_account_id_household_id_fkey'
            columns: ['account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'account_directory'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'account_balance_account_id_household_id_fkey'
            columns: ['account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'account_balance_account_id_household_id_fkey'
            columns: ['account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'accounts_with_balance'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      accounts: {
        Row: {
          created_at: string
          currency: string
          deleted_from_source_at: string | null
          exclude_from_net_worth: boolean
          external_id: string | null
          household_id: string
          id: string
          ledger_resync_pending: boolean
          name: string
          owner_member_id: string | null
          source: Database['public']['Enums']['ledger_source']
          type: Database['public']['Enums']['account_type']
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          currency?: string
          deleted_from_source_at?: string | null
          exclude_from_net_worth?: boolean
          external_id?: string | null
          household_id: string
          id?: string
          ledger_resync_pending?: boolean
          name: string
          owner_member_id?: string | null
          source?: Database['public']['Enums']['ledger_source']
          type?: Database['public']['Enums']['account_type']
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          deleted_from_source_at?: string | null
          exclude_from_net_worth?: boolean
          external_id?: string | null
          household_id?: string
          id?: string
          ledger_resync_pending?: boolean
          name?: string
          owner_member_id?: string | null
          source?: Database['public']['Enums']['ledger_source']
          type?: Database['public']['Enums']['account_type']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'accounts_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'accounts_owner_member_id_household_id_fkey'
            columns: ['owner_member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      apns_device: {
        Row: {
          created_at: string
          environment: string
          household_id: string
          id: string
          member_id: string
          token: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          environment: string
          household_id: string
          id?: string
          member_id: string
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          environment?: string
          household_id?: string
          id?: string
          member_id?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'apns_device_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'apns_device_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      breakdown: {
        Row: {
          created_at: string
          household_id: string
          id: string
          kind: Database['public']['Enums']['breakdown_kind']
          line_group: Database['public']['Enums']['budget_group']
          name: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          kind?: Database['public']['Enums']['breakdown_kind']
          line_group: Database['public']['Enums']['budget_group']
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          kind?: Database['public']['Enums']['breakdown_kind']
          line_group?: Database['public']['Enums']['budget_group']
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'breakdown_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      breakdown_item: {
        Row: {
          amount_cents: number
          breakdown_id: string
          created_at: string
          frequency: Database['public']['Enums']['frequency']
          household_id: string
          id: string
          interval_count: number | null
          name: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          amount_cents: number
          breakdown_id: string
          created_at?: string
          frequency: Database['public']['Enums']['frequency']
          household_id: string
          id?: string
          interval_count?: number | null
          name: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          breakdown_id?: string
          created_at?: string
          frequency?: Database['public']['Enums']['frequency']
          household_id?: string
          id?: string
          interval_count?: number | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'breakdown_item_breakdown_id_household_id_fkey'
            columns: ['breakdown_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'breakdown'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'breakdown_item_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      budget_line: {
        Row: {
          allowance_member_id: string | null
          amount_cents: number
          breakdown_id: string | null
          created_at: string
          destination_account_id: string | null
          frequency: Database['public']['Enums']['frequency']
          gift_recipient_member_id: string | null
          goal_id: string | null
          household_id: string
          id: string
          interval_count: number | null
          is_gift_line: boolean
          line_group: Database['public']['Enums']['budget_group']
          management_url: string | null
          name: string
          retired_on: string | null
          starts_on: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          allowance_member_id?: string | null
          amount_cents: number
          breakdown_id?: string | null
          created_at?: string
          destination_account_id?: string | null
          frequency: Database['public']['Enums']['frequency']
          gift_recipient_member_id?: string | null
          goal_id?: string | null
          household_id: string
          id?: string
          interval_count?: number | null
          is_gift_line?: boolean
          line_group: Database['public']['Enums']['budget_group']
          management_url?: string | null
          name: string
          retired_on?: string | null
          starts_on?: string
          updated_at?: string
        }
        Update: {
          allowance_member_id?: string | null
          amount_cents?: number
          breakdown_id?: string | null
          created_at?: string
          destination_account_id?: string | null
          frequency?: Database['public']['Enums']['frequency']
          gift_recipient_member_id?: string | null
          goal_id?: string | null
          household_id?: string
          id?: string
          interval_count?: number | null
          is_gift_line?: boolean
          line_group?: Database['public']['Enums']['budget_group']
          management_url?: string | null
          name?: string
          retired_on?: string | null
          starts_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'budget_line_allowance_member_id_household_id_fkey'
            columns: ['allowance_member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'member_allowance'
            referencedColumns: ['member_id', 'household_id']
          },
          {
            foreignKeyName: 'budget_line_breakdown_id_household_id_fkey'
            columns: ['breakdown_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'breakdown'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'budget_line_destination_account_id_household_id_fkey'
            columns: ['destination_account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'account_directory'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'budget_line_destination_account_id_household_id_fkey'
            columns: ['destination_account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'budget_line_destination_account_id_household_id_fkey'
            columns: ['destination_account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'accounts_with_balance'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'budget_line_gift_recipient_member_id_household_id_fkey'
            columns: ['gift_recipient_member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'budget_line_goal_id_household_id_fkey'
            columns: ['goal_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'savings_goal'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'budget_line_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      calendar_feed: {
        Row: {
          created_at: string
          household_id: string
          token_hash: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          household_id: string
          token_hash: string
        }
        Update: {
          created_at?: string
          household_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: 'calendar_feed_household_id_fkey'
            columns: ['household_id']
            isOneToOne: true
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          household_id: string
          id: string
          is_archived: boolean
          kind: Database['public']['Enums']['category_kind']
          name: string
          parent_id: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          is_archived?: boolean
          kind: Database['public']['Enums']['category_kind']
          name: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          is_archived?: boolean
          kind?: Database['public']['Enums']['category_kind']
          name?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'categories_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'categories_parent_id_household_id_fkey'
            columns: ['parent_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'categories'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      deduction: {
        Row: {
          amount_cents: number
          basis: Database['public']['Enums']['deduction_basis']
          category: Database['public']['Enums']['deduction_category']
          created_at: string
          deduction_date: string
          description: string
          distance_km: number | null
          financial_year: number
          full_amount_cents: number
          group_id: string | null
          household_id: string
          id: string
          member_id: string
          transaction_id: string | null
          updated_at: string
          work_from_home_hours: number | null
          work_use_percent: number
        }
        ComputedFields: never
        Insert: {
          amount_cents: number
          basis?: Database['public']['Enums']['deduction_basis']
          category?: Database['public']['Enums']['deduction_category']
          created_at?: string
          deduction_date: string
          description: string
          distance_km?: number | null
          financial_year: number
          full_amount_cents: number
          group_id?: string | null
          household_id: string
          id?: string
          member_id: string
          transaction_id?: string | null
          updated_at?: string
          work_from_home_hours?: number | null
          work_use_percent?: number
        }
        Update: {
          amount_cents?: number
          basis?: Database['public']['Enums']['deduction_basis']
          category?: Database['public']['Enums']['deduction_category']
          created_at?: string
          deduction_date?: string
          description?: string
          distance_km?: number | null
          financial_year?: number
          full_amount_cents?: number
          group_id?: string | null
          household_id?: string
          id?: string
          member_id?: string
          transaction_id?: string | null
          updated_at?: string
          work_from_home_hours?: number | null
          work_use_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: 'deduction_group_fk'
            columns: ['group_id', 'household_id', 'member_id', 'financial_year']
            isOneToOne: false
            referencedRelation: 'deduction_group'
            referencedColumns: ['id', 'household_id', 'member_id', 'financial_year']
          },
          {
            foreignKeyName: 'deduction_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'deduction_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'deduction_transaction_id_household_id_fkey'
            columns: ['transaction_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'transactions'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      deduction_group: {
        Row: {
          created_at: string
          financial_year: number
          household_id: string
          id: string
          kind: string
          member_id: string
          name: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          financial_year: number
          household_id: string
          id?: string
          kind?: string
          member_id: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          financial_year?: number
          household_id?: string
          id?: string
          kind?: string
          member_id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'deduction_group_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'deduction_group_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      deduction_receipt: {
        Row: {
          created_at: string
          deduction_id: string
          household_id: string
          id: string
          storage_path: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deduction_id: string
          household_id: string
          id?: string
          storage_path: string
        }
        Update: {
          created_at?: string
          deduction_id?: string
          household_id?: string
          id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: 'deduction_receipt_deduction_id_household_id_fkey'
            columns: ['deduction_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'deduction'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'deduction_receipt_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      equity_exercise: {
        Row: {
          created_at: string
          exercised_on: string
          grant_id: string
          household_id: string
          id: string
          market_price_per_share_cents: number | null
          member_id: string
          quantity: number
          strike_price_cents: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          exercised_on: string
          grant_id: string
          household_id: string
          id?: string
          market_price_per_share_cents?: number | null
          member_id: string
          quantity: number
          strike_price_cents: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          exercised_on?: string
          grant_id?: string
          household_id?: string
          id?: string
          market_price_per_share_cents?: number | null
          member_id?: string
          quantity?: number
          strike_price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'equity_exercise_grant_id_household_id_fkey'
            columns: ['grant_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'equity_grant'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'equity_exercise_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'equity_exercise_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      equity_grant: {
        Row: {
          cliff_months: number
          created_at: string
          grant_date: string
          household_id: string
          id: string
          instrument_type: Database['public']['Enums']['equity_instrument_type']
          label: string
          member_id: string
          price_as_of: string | null
          price_per_share_cents: number
          quantity: number
          strike_price_cents: number | null
          updated_at: string
          vesting_frequency: Database['public']['Enums']['equity_vesting_frequency']
          vesting_period_months: number
        }
        ComputedFields: never
        Insert: {
          cliff_months?: number
          created_at?: string
          grant_date: string
          household_id: string
          id?: string
          instrument_type: Database['public']['Enums']['equity_instrument_type']
          label: string
          member_id: string
          price_as_of?: string | null
          price_per_share_cents?: number
          quantity: number
          strike_price_cents?: number | null
          updated_at?: string
          vesting_frequency?: Database['public']['Enums']['equity_vesting_frequency']
          vesting_period_months?: number
        }
        Update: {
          cliff_months?: number
          created_at?: string
          grant_date?: string
          household_id?: string
          id?: string
          instrument_type?: Database['public']['Enums']['equity_instrument_type']
          label?: string
          member_id?: string
          price_as_of?: string | null
          price_per_share_cents?: number
          quantity?: number
          strike_price_cents?: number | null
          updated_at?: string
          vesting_frequency?: Database['public']['Enums']['equity_vesting_frequency']
          vesting_period_months?: number
        }
        Relationships: [
          {
            foreignKeyName: 'equity_grant_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'equity_grant_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      equity_sale: {
        Row: {
          created_at: string
          fee_cents: number
          grant_id: string
          household_id: string
          id: string
          member_id: string
          price_per_share_cents: number
          quantity: number
          sold_on: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          fee_cents?: number
          grant_id: string
          household_id: string
          id?: string
          member_id: string
          price_per_share_cents: number
          quantity: number
          sold_on: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          fee_cents?: number
          grant_id?: string
          household_id?: string
          id?: string
          member_id?: string
          price_per_share_cents?: number
          quantity?: number
          sold_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'equity_sale_grant_id_household_id_fkey'
            columns: ['grant_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'equity_grant'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'equity_sale_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'equity_sale_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      gift_budget: {
        Row: {
          budgeted_amount_cents: number
          created_at: string
          event_date: string | null
          household_id: string
          id: string
          occasion_id: string
          recipient_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          budgeted_amount_cents?: number
          created_at?: string
          event_date?: string | null
          household_id: string
          id?: string
          occasion_id: string
          recipient_id: string
          updated_at?: string
        }
        Update: {
          budgeted_amount_cents?: number
          created_at?: string
          event_date?: string | null
          household_id?: string
          id?: string
          occasion_id?: string
          recipient_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'gift_budget_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'gift_budget_occasion_id_household_id_fkey'
            columns: ['occasion_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'gift_occasion'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'gift_budget_recipient_id_household_id_fkey'
            columns: ['recipient_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'gift_recipient'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      gift_discretionary_budget: {
        Row: {
          budgeted_amount_cents: number
          created_at: string
          household_id: string
          id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          budgeted_amount_cents?: number
          created_at?: string
          household_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          budgeted_amount_cents?: number
          created_at?: string
          household_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'gift_discretionary_budget_household_id_fkey'
            columns: ['household_id']
            isOneToOne: true
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      gift_occasion: {
        Row: {
          created_at: string
          household_id: string
          id: string
          name: string
          occasion_date: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          name: string
          occasion_date?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          name?: string
          occasion_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'gift_occasion_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      gift_purchase: {
        Row: {
          amount_cents: number
          created_at: string
          description: string
          gift_budget_id: string | null
          gift_discretionary_budget_id: string | null
          household_id: string
          id: string
          purchased_on: string
          recipient_id: string | null
          transaction_id: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          amount_cents: number
          created_at?: string
          description?: string
          gift_budget_id?: string | null
          gift_discretionary_budget_id?: string | null
          household_id: string
          id?: string
          purchased_on: string
          recipient_id?: string | null
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          description?: string
          gift_budget_id?: string | null
          gift_discretionary_budget_id?: string | null
          household_id?: string
          id?: string
          purchased_on?: string
          recipient_id?: string | null
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'gift_purchase_gift_budget_id_household_id_fkey'
            columns: ['gift_budget_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'gift_budget'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'gift_purchase_gift_discretionary_budget_id_household_id_fkey'
            columns: ['gift_discretionary_budget_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'gift_discretionary_budget'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'gift_purchase_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'gift_purchase_recipient_id_household_id_fkey'
            columns: ['recipient_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'gift_recipient'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'gift_purchase_transaction_id_household_id_fkey'
            columns: ['transaction_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'transactions'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      gift_recipient: {
        Row: {
          created_at: string
          household_id: string
          id: string
          member_id: string | null
          name: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          member_id?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          member_id?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'gift_recipient_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'gift_recipient_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      gift_transaction_dismissal: {
        Row: {
          created_at: string
          household_id: string
          id: string
          transaction_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          transaction_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          transaction_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'gift_transaction_dismissal_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'gift_transaction_dismissal_transaction_id_household_id_fkey'
            columns: ['transaction_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'transactions'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      help_debt: {
        Row: {
          balance_cents: number
          created_at: string
          household_id: string
          id: string
          member_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          balance_cents?: number
          created_at?: string
          household_id: string
          id?: string
          member_id: string
          updated_at?: string
        }
        Update: {
          balance_cents?: number
          created_at?: string
          household_id?: string
          id?: string
          member_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'help_debt_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'help_debt_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      household_default_budget_line: {
        Row: {
          budget_line_id: string | null
          created_at: string
          household_id: string
          valid_from: string
        }
        ComputedFields: never
        Insert: {
          budget_line_id?: string | null
          created_at?: string
          household_id: string
          valid_from: string
        }
        Update: {
          budget_line_id?: string | null
          created_at?: string
          household_id?: string
          valid_from?: string
        }
        Relationships: [
          {
            foreignKeyName: 'household_default_budget_line_budget_line_id_household_id_fkey'
            columns: ['budget_line_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'budget_line'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'household_default_budget_line_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      households: {
        Row: {
          created_at: string
          id: string
          invite_code: string | null
          invite_code_expires_at: string | null
          name: string
          pay_account_id: string | null
          timezone: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          invite_code?: string | null
          invite_code_expires_at?: string | null
          name: string
          pay_account_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          invite_code?: string | null
          invite_code_expires_at?: string | null
          name?: string
          pay_account_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'households_pay_account_id_fkey'
            columns: ['pay_account_id', 'id']
            isOneToOne: false
            referencedRelation: 'account_directory'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'households_pay_account_id_fkey'
            columns: ['pay_account_id', 'id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'households_pay_account_id_fkey'
            columns: ['pay_account_id', 'id']
            isOneToOne: false
            referencedRelation: 'accounts_with_balance'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      inflows: {
        Row: {
          amount_cents: number | null
          arrives_every_pay_period: boolean
          attracts_super: boolean
          created_at: string
          ends_on: string | null
          hourly_rate_cents: number | null
          hours_per_period: number | null
          household_id: string
          id: string
          interval_count: number | null
          is_joint: boolean
          member_id: string | null
          member_split_percent: number | null
          name: string
          one_off_tax_treatment: Database['public']['Enums']['one_off_tax_treatment'] | null
          paid_on: string | null
          pay_anchor_date: string | null
          pay_interval_count: number | null
          pay_schedule: Database['public']['Enums']['frequency'] | null
          schedule: Database['public']['Enums']['frequency'] | null
          starts_on: string | null
          taxable: boolean
          type: Database['public']['Enums']['inflow_type']
          updated_at: string
          years_of_service: number | null
        }
        ComputedFields: never
        Insert: {
          amount_cents?: number | null
          arrives_every_pay_period?: boolean
          attracts_super?: boolean
          created_at?: string
          ends_on?: string | null
          hourly_rate_cents?: number | null
          hours_per_period?: number | null
          household_id: string
          id?: string
          interval_count?: number | null
          is_joint?: boolean
          member_id?: string | null
          member_split_percent?: number | null
          name: string
          one_off_tax_treatment?: Database['public']['Enums']['one_off_tax_treatment'] | null
          paid_on?: string | null
          pay_anchor_date?: string | null
          pay_interval_count?: number | null
          pay_schedule?: Database['public']['Enums']['frequency'] | null
          schedule?: Database['public']['Enums']['frequency'] | null
          starts_on?: string | null
          taxable?: boolean
          type: Database['public']['Enums']['inflow_type']
          updated_at?: string
          years_of_service?: number | null
        }
        Update: {
          amount_cents?: number | null
          arrives_every_pay_period?: boolean
          attracts_super?: boolean
          created_at?: string
          ends_on?: string | null
          hourly_rate_cents?: number | null
          hours_per_period?: number | null
          household_id?: string
          id?: string
          interval_count?: number | null
          is_joint?: boolean
          member_id?: string | null
          member_split_percent?: number | null
          name?: string
          one_off_tax_treatment?: Database['public']['Enums']['one_off_tax_treatment'] | null
          paid_on?: string | null
          pay_anchor_date?: string | null
          pay_interval_count?: number | null
          pay_schedule?: Database['public']['Enums']['frequency'] | null
          schedule?: Database['public']['Enums']['frequency'] | null
          starts_on?: string | null
          taxable?: boolean
          type?: Database['public']['Enums']['inflow_type']
          updated_at?: string
          years_of_service?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'inflows_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inflows_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      member_allowance: {
        Row: {
          amount_cents: number
          created_at: string
          destination_account_id: string | null
          frequency: Database['public']['Enums']['frequency']
          household_id: string
          id: string
          interval_count: number | null
          member_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          amount_cents: number
          created_at?: string
          destination_account_id?: string | null
          frequency: Database['public']['Enums']['frequency']
          household_id: string
          id?: string
          interval_count?: number | null
          member_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          destination_account_id?: string | null
          frequency?: Database['public']['Enums']['frequency']
          household_id?: string
          id?: string
          interval_count?: number | null
          member_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'member_allowance_destination_account_id_household_id_fkey'
            columns: ['destination_account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'account_directory'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'member_allowance_destination_account_id_household_id_fkey'
            columns: ['destination_account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'member_allowance_destination_account_id_household_id_fkey'
            columns: ['destination_account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'accounts_with_balance'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'member_allowance_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'member_allowance_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      members: {
        Row: {
          created_at: string
          date_of_birth: string | null
          email: string | null
          household_id: string
          id: string
          name: string
          up_connected_at: string | null
          up_sync_failed_at: string | null
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          household_id: string
          id?: string
          name: string
          up_connected_at?: string | null
          up_sync_failed_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          household_id?: string
          id?: string
          name?: string
          up_connected_at?: string | null
          up_sync_failed_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'members_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      notification_log: {
        Row: {
          dedupe_key: string
          household_id: string
          id: string
          member_id: string
          sent_at: string
          trigger: Database['public']['Enums']['notification_trigger']
        }
        ComputedFields: never
        Insert: {
          dedupe_key: string
          household_id: string
          id?: string
          member_id: string
          sent_at?: string
          trigger: Database['public']['Enums']['notification_trigger']
        }
        Update: {
          dedupe_key?: string
          household_id?: string
          id?: string
          member_id?: string
          sent_at?: string
          trigger?: Database['public']['Enums']['notification_trigger']
        }
        Relationships: [
          {
            foreignKeyName: 'notification_log_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notification_log_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      notification_preference: {
        Row: {
          created_at: string
          enabled: boolean
          household_id: string
          id: string
          member_id: string
          trigger: Database['public']['Enums']['notification_trigger']
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          enabled?: boolean
          household_id: string
          id?: string
          member_id: string
          trigger: Database['public']['Enums']['notification_trigger']
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          household_id?: string
          id?: string
          member_id?: string
          trigger?: Database['public']['Enums']['notification_trigger']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'notification_preference_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notification_preference_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      pay_split: {
        Row: {
          account_id: string
          confirmed_at: string
          confirmed_fortnightly_cents: number
          created_at: string
          household_id: string
          id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          account_id: string
          confirmed_at?: string
          confirmed_fortnightly_cents: number
          created_at?: string
          household_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          confirmed_at?: string
          confirmed_fortnightly_cents?: number
          created_at?: string
          household_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'pay_split_account_id_household_id_fkey'
            columns: ['account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'account_directory'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'pay_split_account_id_household_id_fkey'
            columns: ['account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'pay_split_account_id_household_id_fkey'
            columns: ['account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'accounts_with_balance'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'pay_split_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      payslip: {
        Row: {
          created_at: string
          file_path: string | null
          financial_year: number
          gross_cents: number
          household_id: string
          id: string
          member_id: string
          net_cents: number
          note: string | null
          paid_on: string | null
          period_end: string
          period_start: string
          salary_sacrifice_cents: number | null
          super_cents: number
          tax_withheld_cents: number
          updated_at: string
          ytd_gross_cents: number | null
          ytd_super_cents: number | null
          ytd_tax_withheld_cents: number | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          file_path?: string | null
          financial_year: number
          gross_cents: number
          household_id: string
          id?: string
          member_id: string
          net_cents: number
          note?: string | null
          paid_on?: string | null
          period_end: string
          period_start: string
          salary_sacrifice_cents?: number | null
          super_cents: number
          tax_withheld_cents: number
          updated_at?: string
          ytd_gross_cents?: number | null
          ytd_super_cents?: number | null
          ytd_tax_withheld_cents?: number | null
        }
        Update: {
          created_at?: string
          file_path?: string | null
          financial_year?: number
          gross_cents?: number
          household_id?: string
          id?: string
          member_id?: string
          net_cents?: number
          note?: string | null
          paid_on?: string | null
          period_end?: string
          period_start?: string
          salary_sacrifice_cents?: number | null
          super_cents?: number
          tax_withheld_cents?: number
          updated_at?: string
          ytd_gross_cents?: number | null
          ytd_super_cents?: number | null
          ytd_tax_withheld_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'payslip_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'payslip_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      payslip_line: {
        Row: {
          amount_cents: number
          attracts_super: boolean | null
          created_at: string
          household_id: string
          id: string
          kind: Database['public']['Enums']['payslip_line_kind']
          label: string
          payslip_id: string
          source_inflow_id: string | null
          tax_component: Database['public']['Enums']['payslip_tax_component'] | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          amount_cents: number
          attracts_super?: boolean | null
          created_at?: string
          household_id: string
          id?: string
          kind?: Database['public']['Enums']['payslip_line_kind']
          label: string
          payslip_id: string
          source_inflow_id?: string | null
          tax_component?: Database['public']['Enums']['payslip_tax_component'] | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          attracts_super?: boolean | null
          created_at?: string
          household_id?: string
          id?: string
          kind?: Database['public']['Enums']['payslip_line_kind']
          label?: string
          payslip_id?: string
          source_inflow_id?: string | null
          tax_component?: Database['public']['Enums']['payslip_tax_component'] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'payslip_line_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'payslip_line_payslip_id_household_id_fkey'
            columns: ['payslip_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'payslip'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'payslip_line_source_inflow_id_household_id_fkey'
            columns: ['source_inflow_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'inflows'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      push_subscription: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          household_id: string
          id: string
          member_id: string
          p256dh: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          household_id: string
          id?: string
          member_id: string
          p256dh: string
          updated_at?: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          household_id?: string
          id?: string
          member_id?: string
          p256dh?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'push_subscription_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'push_subscription_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      redbark_connection: {
        Row: {
          created_at: string
          household_id: string
          id: string
          institution_name: string | null
          member_id: string
          status: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          household_id: string
          id: string
          institution_name?: string | null
          member_id: string
          status: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          institution_name?: string | null
          member_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'redbark_connection_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'redbark_connection_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      savings_goal: {
        Row: {
          annual_interest_bps: number | null
          created_at: string
          current_balance_cents: number
          household_id: string
          id: string
          linked_account_id: string | null
          name: string
          planned_contribution_cents: number | null
          queue_position: number | null
          target_amount_cents: number
          target_date: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          annual_interest_bps?: number | null
          created_at?: string
          current_balance_cents?: number
          household_id: string
          id?: string
          linked_account_id?: string | null
          name: string
          planned_contribution_cents?: number | null
          queue_position?: number | null
          target_amount_cents: number
          target_date?: string | null
          updated_at?: string
        }
        Update: {
          annual_interest_bps?: number | null
          created_at?: string
          current_balance_cents?: number
          household_id?: string
          id?: string
          linked_account_id?: string | null
          name?: string
          planned_contribution_cents?: number | null
          queue_position?: number | null
          target_amount_cents?: number
          target_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'savings_goal_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'savings_goal_linked_account_id_household_id_fkey'
            columns: ['linked_account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'account_directory'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'savings_goal_linked_account_id_household_id_fkey'
            columns: ['linked_account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'savings_goal_linked_account_id_household_id_fkey'
            columns: ['linked_account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'accounts_with_balance'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      share_grant: {
        Row: {
          created_at: string
          created_by_member_id: string | null
          expires_at: string
          financial_year: number
          household_id: string
          recipient_email: string
          token_hash: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by_member_id?: string | null
          expires_at: string
          financial_year: number
          household_id: string
          recipient_email: string
          token_hash: string
        }
        Update: {
          created_at?: string
          created_by_member_id?: string | null
          expires_at?: string
          financial_year?: number
          household_id?: string
          recipient_email?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: 'share_grant_created_by_member_id_fkey'
            columns: ['created_by_member_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'share_grant_household_id_fkey'
            columns: ['household_id']
            isOneToOne: true
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      spend_rule: {
        Row: {
          allowance_member_id: string | null
          budget_line_id: string | null
          created_at: string
          household_id: string
          id: string
          target_kind: Database['public']['Enums']['spend_target_kind']
        }
        ComputedFields: never
        Insert: {
          allowance_member_id?: string | null
          budget_line_id?: string | null
          created_at?: string
          household_id: string
          id?: string
          target_kind: Database['public']['Enums']['spend_target_kind']
        }
        Update: {
          allowance_member_id?: string | null
          budget_line_id?: string | null
          created_at?: string
          household_id?: string
          id?: string
          target_kind?: Database['public']['Enums']['spend_target_kind']
        }
        Relationships: [
          {
            foreignKeyName: 'spend_rule_allowance_member_id_household_id_fkey'
            columns: ['allowance_member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'member_allowance'
            referencedColumns: ['member_id', 'household_id']
          },
          {
            foreignKeyName: 'spend_rule_budget_line_id_household_id_fkey'
            columns: ['budget_line_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'budget_line'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'spend_rule_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      spend_rule_version: {
        Row: {
          account_ids: string[] | null
          amount_cents: number | null
          amount_max_cents: number | null
          amount_min_cents: number | null
          created_at: string
          description_match: Database['public']['Enums']['spend_rule_text_match'] | null
          description_pattern: string | null
          household_id: string
          rule_id: string
          sort_order: number
          text_pattern: string | null
          up_category_ids: string[] | null
          valid_from: string
          valid_until: string | null
          version: number
        }
        ComputedFields: never
        Insert: {
          account_ids?: string[] | null
          amount_cents?: number | null
          amount_max_cents?: number | null
          amount_min_cents?: number | null
          created_at?: string
          description_match?: Database['public']['Enums']['spend_rule_text_match'] | null
          description_pattern?: string | null
          household_id: string
          rule_id: string
          sort_order: number
          text_pattern?: string | null
          up_category_ids?: string[] | null
          valid_from: string
          valid_until?: string | null
          version: number
        }
        Update: {
          account_ids?: string[] | null
          amount_cents?: number | null
          amount_max_cents?: number | null
          amount_min_cents?: number | null
          created_at?: string
          description_match?: Database['public']['Enums']['spend_rule_text_match'] | null
          description_pattern?: string | null
          household_id?: string
          rule_id?: string
          sort_order?: number
          text_pattern?: string | null
          up_category_ids?: string[] | null
          valid_from?: string
          valid_until?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'spend_rule_version_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'spend_rule_version_rule_id_household_id_fkey'
            columns: ['rule_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'current_spend_rules'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'spend_rule_version_rule_id_household_id_fkey'
            columns: ['rule_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'spend_rule'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      super_contribution: {
        Row: {
          amount_cents: number | null
          contributor_member_id: string | null
          created_at: string
          fhss_eligible: boolean
          financial_year: number
          frequency: Database['public']['Enums']['frequency']
          household_id: string
          id: string
          interval_count: number | null
          kind: Database['public']['Enums']['super_contribution_kind']
          member_id: string
          mode: Database['public']['Enums']['super_contribution_mode']
          percent_bp: number | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          amount_cents?: number | null
          contributor_member_id?: string | null
          created_at?: string
          fhss_eligible?: boolean
          financial_year: number
          frequency: Database['public']['Enums']['frequency']
          household_id: string
          id?: string
          interval_count?: number | null
          kind: Database['public']['Enums']['super_contribution_kind']
          member_id: string
          mode: Database['public']['Enums']['super_contribution_mode']
          percent_bp?: number | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number | null
          contributor_member_id?: string | null
          created_at?: string
          fhss_eligible?: boolean
          financial_year?: number
          frequency?: Database['public']['Enums']['frequency']
          household_id?: string
          id?: string
          interval_count?: number | null
          kind?: Database['public']['Enums']['super_contribution_kind']
          member_id?: string
          mode?: Database['public']['Enums']['super_contribution_mode']
          percent_bp?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'super_contribution_contributor_member_id_household_id_fkey'
            columns: ['contributor_member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'super_contribution_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'super_contribution_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      super_profile: {
        Row: {
          balance_as_of: string | null
          carry_forward_cap_cents: number
          created_at: string
          financial_year: number
          fund_name: string | null
          household_id: string
          id: string
          linked_account_id: string | null
          member_id: string
          sg_rate_override: number | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          balance_as_of?: string | null
          carry_forward_cap_cents?: number
          created_at?: string
          financial_year: number
          fund_name?: string | null
          household_id: string
          id?: string
          linked_account_id?: string | null
          member_id: string
          sg_rate_override?: number | null
          updated_at?: string
        }
        Update: {
          balance_as_of?: string | null
          carry_forward_cap_cents?: number
          created_at?: string
          financial_year?: number
          fund_name?: string | null
          household_id?: string
          id?: string
          linked_account_id?: string | null
          member_id?: string
          sg_rate_override?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'super_profile_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'super_profile_linked_account_id_household_id_fkey'
            columns: ['linked_account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'account_directory'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'super_profile_linked_account_id_household_id_fkey'
            columns: ['linked_account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'super_profile_linked_account_id_household_id_fkey'
            columns: ['linked_account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'accounts_with_balance'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'super_profile_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      tax_profile: {
        Row: {
          created_at: string
          financial_year: number
          has_private_hospital_cover: boolean
          household_id: string
          id: string
          member_id: string
          residency: Database['public']['Enums']['tax_residency']
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          financial_year: number
          has_private_hospital_cover?: boolean
          household_id: string
          id?: string
          member_id: string
          residency?: Database['public']['Enums']['tax_residency']
          updated_at?: string
        }
        Update: {
          created_at?: string
          financial_year?: number
          has_private_hospital_cover?: boolean
          household_id?: string
          id?: string
          member_id?: string
          residency?: Database['public']['Enums']['tax_residency']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tax_profile_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tax_profile_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      temporary_item: {
        Row: {
          contribution_cents: number
          created_at: string
          household_id: string
          id: string
          name: string
          target_date: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          contribution_cents: number
          created_at?: string
          household_id: string
          id?: string
          name: string
          target_date: string
          updated_at?: string
        }
        Update: {
          contribution_cents?: number
          created_at?: string
          household_id?: string
          id?: string
          name?: string
          target_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'temporary_item_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      trade: {
        Row: {
          created_at: string
          document_id: string | null
          external_id: string | null
          fee_cents: number
          household_id: string
          id: string
          member_id: string
          price_per_unit_microdollars: number
          side: Database['public']['Enums']['trade_side']
          source: Database['public']['Enums']['ledger_source']
          ticker: string
          traded_on: string
          units: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          document_id?: string | null
          external_id?: string | null
          fee_cents?: number
          household_id: string
          id?: string
          member_id: string
          price_per_unit_microdollars: number
          side: Database['public']['Enums']['trade_side']
          source?: Database['public']['Enums']['ledger_source']
          ticker: string
          traded_on: string
          units: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_id?: string | null
          external_id?: string | null
          fee_cents?: number
          household_id?: string
          id?: string
          member_id?: string
          price_per_unit_microdollars?: number
          side?: Database['public']['Enums']['trade_side']
          source?: Database['public']['Enums']['ledger_source']
          ticker?: string
          traded_on?: string
          units?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'trade_document_id_household_id_fkey'
            columns: ['document_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'trade_document'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'trade_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'trade_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      trade_document: {
        Row: {
          created_at: string
          household_id: string
          id: string
          storage_path: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          storage_path: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: 'trade_document_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      transaction_allocation: {
        Row: {
          allowance_member_id: string | null
          amount_cents: number
          budget_line_id: string | null
          created_at: string
          household_id: string
          id: string
          member_id: string | null
          origin: Database['public']['Enums']['spend_allocation_origin']
          target_kind: Database['public']['Enums']['spend_target_kind']
          transaction_id: string
        }
        ComputedFields: never
        Insert: {
          allowance_member_id?: string | null
          amount_cents: number
          budget_line_id?: string | null
          created_at?: string
          household_id: string
          id?: string
          member_id?: string | null
          origin: Database['public']['Enums']['spend_allocation_origin']
          target_kind: Database['public']['Enums']['spend_target_kind']
          transaction_id: string
        }
        Update: {
          allowance_member_id?: string | null
          amount_cents?: number
          budget_line_id?: string | null
          created_at?: string
          household_id?: string
          id?: string
          member_id?: string | null
          origin?: Database['public']['Enums']['spend_allocation_origin']
          target_kind?: Database['public']['Enums']['spend_target_kind']
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'transaction_allocation_allowance_member_id_household_id_fkey'
            columns: ['allowance_member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'member_allowance'
            referencedColumns: ['member_id', 'household_id']
          },
          {
            foreignKeyName: 'transaction_allocation_budget_line_id_household_id_fkey'
            columns: ['budget_line_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'budget_line'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'transaction_allocation_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'transaction_allocation_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'transaction_allocation_transaction_id_household_id_fkey'
            columns: ['transaction_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'transactions'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string
          amount_cents: number
          category_flagged_wrong_at: string | null
          category_flagged_wrong_by_member_id: string | null
          category_id: string | null
          created_at: string
          deep_link_url: string | null
          description: string
          external_category: string | null
          external_category_since: string
          external_id: string | null
          external_parent_category: string | null
          household_id: string
          id: string
          is_categorizable: boolean | null
          kind: Database['public']['Enums']['transaction_kind']
          member_id: string | null
          notes: string | null
          performing_customer_name: string | null
          posted_at: string
          reviewed_at: string | null
          reviewed_by_member_id: string | null
          source: Database['public']['Enums']['ledger_source']
          status: Database['public']['Enums']['transaction_status']
          transaction_type: string | null
          up_message: string | null
          up_note: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          account_id: string
          amount_cents: number
          category_flagged_wrong_at?: string | null
          category_flagged_wrong_by_member_id?: string | null
          category_id?: string | null
          created_at?: string
          deep_link_url?: string | null
          description?: string
          external_category?: string | null
          external_category_since?: string
          external_id?: string | null
          external_parent_category?: string | null
          household_id: string
          id?: string
          is_categorizable?: boolean | null
          kind: Database['public']['Enums']['transaction_kind']
          member_id?: string | null
          notes?: string | null
          performing_customer_name?: string | null
          posted_at: string
          reviewed_at?: string | null
          reviewed_by_member_id?: string | null
          source?: Database['public']['Enums']['ledger_source']
          status?: Database['public']['Enums']['transaction_status']
          transaction_type?: string | null
          up_message?: string | null
          up_note?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount_cents?: number
          category_flagged_wrong_at?: string | null
          category_flagged_wrong_by_member_id?: string | null
          category_id?: string | null
          created_at?: string
          deep_link_url?: string | null
          description?: string
          external_category?: string | null
          external_category_since?: string
          external_id?: string | null
          external_parent_category?: string | null
          household_id?: string
          id?: string
          is_categorizable?: boolean | null
          kind?: Database['public']['Enums']['transaction_kind']
          member_id?: string | null
          notes?: string | null
          performing_customer_name?: string | null
          posted_at?: string
          reviewed_at?: string | null
          reviewed_by_member_id?: string | null
          source?: Database['public']['Enums']['ledger_source']
          status?: Database['public']['Enums']['transaction_status']
          transaction_type?: string | null
          up_message?: string | null
          up_note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'transactions_account_id_household_id_fkey'
            columns: ['account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'account_directory'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'transactions_account_id_household_id_fkey'
            columns: ['account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'transactions_account_id_household_id_fkey'
            columns: ['account_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'accounts_with_balance'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'transactions_category_flagged_wrong_by_member_id_fkey'
            columns: ['category_flagged_wrong_by_member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'transactions_category_id_household_id_fkey'
            columns: ['category_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'categories'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'transactions_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'transactions_member_id_household_id_fkey'
            columns: ['member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'transactions_reviewed_by_member_id_fkey'
            columns: ['reviewed_by_member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      up_category: {
        Row: {
          id: string
          name: string
          parent_id: string | null
        }
        ComputedFields: never
        Insert: {
          id: string
          name: string
          parent_id?: string | null
        }
        Update: {
          id?: string
          name?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'up_category_parent_id_fkey'
            columns: ['parent_id']
            isOneToOne: false
            referencedRelation: 'up_category'
            referencedColumns: ['id']
          },
        ]
      }
      up_category_default_group: {
        Row: {
          category_id: string
          line_group: Database['public']['Enums']['budget_group']
        }
        ComputedFields: never
        Insert: {
          category_id: string
          line_group: Database['public']['Enums']['budget_group']
        }
        Update: {
          category_id?: string
          line_group?: Database['public']['Enums']['budget_group']
        }
        Relationships: []
      }
      up_category_group: {
        Row: {
          category_id: string
          household_id: string
          line_group: Database['public']['Enums']['budget_group'] | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          category_id: string
          household_id: string
          line_group?: Database['public']['Enums']['budget_group'] | null
          updated_at?: string
        }
        Update: {
          category_id?: string
          household_id?: string
          line_group?: Database['public']['Enums']['budget_group'] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'up_category_group_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      up_webhook: {
        Row: {
          created_at: string
          member_id: string
          webhook_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          member_id: string
          webhook_id: string
        }
        Update: {
          created_at?: string
          member_id?: string
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'up_webhook_member_id_fkey'
            columns: ['member_id']
            isOneToOne: true
            referencedRelation: 'members'
            referencedColumns: ['id']
          },
        ]
      }
      wishlist_item: {
        Row: {
          amount_cents: number
          created_at: string
          household_id: string
          id: string
          member_id: string | null
          name: string
          note: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          amount_cents: number
          created_at?: string
          household_id: string
          id?: string
          member_id?: string | null
          name: string
          note?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          household_id?: string
          id?: string
          member_id?: string | null
          name?: string
          note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'wishlist_item_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'wishlist_item_member_id_fkey'
            columns: ['member_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      account_directory: {
        Row: {
          deleted_from_source_at: string | null
          household_id: string | null
          id: string | null
          name: string | null
          owner_member_id: string | null
          source: Database['public']['Enums']['ledger_source'] | null
          type: Database['public']['Enums']['account_type'] | null
        }
        ComputedFields: never
        Insert: {
          deleted_from_source_at?: string | null
          household_id?: string | null
          id?: string | null
          name?: string | null
          owner_member_id?: string | null
          source?: Database['public']['Enums']['ledger_source'] | null
          type?: Database['public']['Enums']['account_type'] | null
        }
        Update: {
          deleted_from_source_at?: string | null
          household_id?: string | null
          id?: string | null
          name?: string | null
          owner_member_id?: string | null
          source?: Database['public']['Enums']['ledger_source'] | null
          type?: Database['public']['Enums']['account_type'] | null
        }
        Relationships: [
          {
            foreignKeyName: 'accounts_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'accounts_owner_member_id_household_id_fkey'
            columns: ['owner_member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      accounts_with_balance: {
        Row: {
          balance_cents: number | null
          created_at: string | null
          currency: string | null
          deleted_from_source_at: string | null
          exclude_from_net_worth: boolean | null
          external_id: string | null
          household_id: string | null
          id: string | null
          name: string | null
          owner_member_id: string | null
          source: Database['public']['Enums']['ledger_source'] | null
          type: Database['public']['Enums']['account_type'] | null
          updated_at: string | null
        }
        ComputedFields: never
        Relationships: [
          {
            foreignKeyName: 'accounts_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'accounts_owner_member_id_household_id_fkey'
            columns: ['owner_member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'members'
            referencedColumns: ['id', 'household_id']
          },
        ]
      }
      current_spend_rules: {
        Row: {
          account_ids: string[] | null
          allowance_member_id: string | null
          amount_cents: number | null
          amount_max_cents: number | null
          amount_min_cents: number | null
          budget_line_id: string | null
          created_at: string | null
          description_match: Database['public']['Enums']['spend_rule_text_match'] | null
          description_pattern: string | null
          first_valid_from: string | null
          household_id: string | null
          id: string | null
          sort_order: number | null
          target_kind: Database['public']['Enums']['spend_target_kind'] | null
          text_pattern: string | null
          up_category_ids: string[] | null
          valid_from: string | null
          version: number | null
        }
        ComputedFields: never
        Relationships: [
          {
            foreignKeyName: 'spend_rule_allowance_member_id_household_id_fkey'
            columns: ['allowance_member_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'member_allowance'
            referencedColumns: ['member_id', 'household_id']
          },
          {
            foreignKeyName: 'spend_rule_budget_line_id_household_id_fkey'
            columns: ['budget_line_id', 'household_id']
            isOneToOne: false
            referencedRelation: 'budget_line'
            referencedColumns: ['id', 'household_id']
          },
          {
            foreignKeyName: 'spend_rule_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Functions: {
      actual_spend_by_target: {
        Args: { p_end: string; p_start: string }
        Returns: {
          allowance_member_id: string
          budget_line_id: string
          spent_cents: number
          status: Database['public']['Enums']['transaction_status']
          target_kind: Database['public']['Enums']['spend_target_kind']
          transaction_count: number
        }[]
      }
      anthropic_api_key: { Args: Record<PropertyKey, never>; Returns: string }
      apns_keys: {
        Args: Record<PropertyKey, never>
        Returns: {
          bundle_id: string
          key_id: string
          private_key: string
          team_id: string
        }[]
      }
      assert_budget_line_active: {
        Args: { p_budget_line_id: string; p_on: string; p_require_started: boolean }
        Returns: undefined
      }
      assert_spend_target: {
        Args: {
          p_allowance_member_id: string
          p_budget_line_id: string
          p_household_id: string
          p_target_kind: Database['public']['Enums']['spend_target_kind']
        }
        Returns: undefined
      }
      budget_actual_spend: {
        Args: { p_end: string; p_include_pending?: boolean; p_start: string }
        Returns: {
          line_group: Database['public']['Enums']['budget_group']
          spent_cents: number
        }[]
      }
      budget_line_derived_fields: {
        Args: {
          p_breakdown_id: string
          p_current_destination: string
          p_current_group: Database['public']['Enums']['budget_group']
          p_current_name: string
          p_gift_recipient_member_id: string
          p_household_id: string
          p_is_gift_line: boolean
        }
        Returns: Record<string, unknown>
      }
      budget_line_has_counted_spend: { Args: { p_budget_line_id: string }; Returns: boolean }
      budget_lines_with_counted_spend: { Args: Record<PropertyKey, never>; Returns: string[] }
      caller_household_today: { Args: Record<PropertyKey, never>; Returns: string }
      change_budget_line_from: {
        Args: {
          p_amount_cents: number
          p_budget_line_id: string
          p_change_on: string
          p_frequency: Database['public']['Enums']['frequency']
          p_interval_count?: number
          p_line_group: Database['public']['Enums']['budget_group']
          p_name: string
        }
        Returns: string
      }
      clear_transaction_spend_target: { Args: { p_transaction_id: string }; Returns: undefined }
      clear_up_token: { Args: { p_member_id: string }; Returns: undefined }
      clear_up_webhook: { Args: { p_member_id: string }; Returns: undefined }
      commit_planning_changes: {
        Args: {
          p_budget_line_creates?: Json
          p_budget_line_deletes?: string[]
          p_budget_line_updates?: Json
          p_inflow_creates?: Json
          p_inflow_deletes?: string[]
          p_inflow_updates?: Json
          p_savings_goal_creates?: Json
          p_savings_goal_deletes?: string[]
          p_savings_goal_updates?: Json
        }
        Returns: undefined
      }
      create_calendar_feed_token: { Args: Record<PropertyKey, never>; Returns: string }
      create_deduction_with_receipt: {
        Args: { p_deduction: Json; p_receipt_path?: string }
        Returns: string
      }
      create_household: { Args: { p_member_name: string; p_name: string }; Returns: string }
      create_invite_code: {
        Args: Record<PropertyKey, never>
        Returns: {
          invite_code: string
          invite_code_expires_at: string
        }[]
      }
      create_share_grant: {
        Args: { p_financial_year: number; p_recipient_email: string }
        Returns: {
          expires_at: string
          token: string
        }[]
      }
      create_spend_rule: {
        Args: {
          p_account_ids?: string[]
          p_allowance_member_id?: string
          p_amount_cents?: number
          p_amount_max_cents?: number
          p_amount_min_cents?: number
          p_apply_from?: string
          p_budget_line_id?: string
          p_description_match?: Database['public']['Enums']['spend_rule_text_match']
          p_description_pattern?: string
          p_target_kind: Database['public']['Enums']['spend_target_kind']
          p_text_pattern?: string
          p_up_category_ids?: string[]
        }
        Returns: string
      }
      create_trades_with_document: {
        Args: {
          p_document_id: string
          p_document_path: string
          p_household_id: string
          p_trades: Json
        }
        Returns: number
      }
      current_member_ids: { Args: Record<PropertyKey, never>; Returns: string[] }
      delete_spend_rule: { Args: { p_apply_from?: string; p_rule_id: string }; Returns: undefined }
      delete_up_transactions: {
        Args: { p_external_ids: string[]; p_household_id: string }
        Returns: undefined
      }
      fail_up_token: { Args: { p_member_id: string }; Returns: undefined }
      flag_transaction_category: {
        Args: { p_transaction_id: string }
        Returns: {
          account_id: string
          amount_cents: number
          category_flagged_wrong_at: string | null
          category_flagged_wrong_by_member_id: string | null
          category_id: string | null
          created_at: string
          deep_link_url: string | null
          description: string
          external_category: string | null
          external_category_since: string
          external_id: string | null
          external_parent_category: string | null
          household_id: string
          id: string
          is_categorizable: boolean | null
          kind: Database['public']['Enums']['transaction_kind']
          member_id: string | null
          notes: string | null
          performing_customer_name: string | null
          posted_at: string
          reviewed_at: string | null
          reviewed_by_member_id: string | null
          source: Database['public']['Enums']['ledger_source']
          status: Database['public']['Enums']['transaction_status']
          transaction_type: string | null
          up_message: string | null
          up_note: string | null
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'transactions'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      hidden_gift_budget_ids_for_current_member: {
        Args: Record<PropertyKey, never>
        Returns: string[]
      }
      hidden_gift_recipient_ids_for_current_member: {
        Args: Record<PropertyKey, never>
        Returns: string[]
      }
      hidden_gift_transaction_ids_for_current_member: {
        Args: Record<PropertyKey, never>
        Returns: string[]
      }
      household_day_start: { Args: { p_day: string; p_household_id: string }; Returns: string }
      household_default_budget_line_on: {
        Args: { p_day: string; p_household_id: string }
        Returns: string
      }
      household_ids_for_current_user: { Args: Record<PropertyKey, never>; Returns: string[] }
      household_spend_resolution: {
        Args: {
          p_end?: string
          p_household_id: string
          p_start?: string
          p_transaction_ids?: string[]
          p_visible_only: boolean
        }
        Returns: {
          allowance_member_id: string
          amount_cents: number
          budget_line_id: string
          posted_at: string
          reason: Database['public']['Enums']['spend_resolution_reason']
          rule_id: string
          rule_version: number
          status: Database['public']['Enums']['transaction_status']
          target_kind: Database['public']['Enums']['spend_target_kind']
          transaction_id: string
        }[]
      }
      household_super_account_ids: { Args: Record<PropertyKey, never>; Returns: string[] }
      household_today: { Args: { p_household_id: string }; Returns: string }
      is_default_budget_line_from: {
        Args: {
          p_line: Omit<
            Database['public']['Tables']['budget_line']['Row'],
            Database['public']['Tables']['budget_line']['ComputedFields']
          >
          p_on: string
        }
        Returns: boolean
      }
      join_household: { Args: { p_code: string; p_member_name: string }; Returns: string }
      payslip_financial_year: { Args: { paid_on: string; period_end: string }; Returns: number }
      preview_spend_rule: {
        Args: {
          p_account_ids?: string[]
          p_allowance_member_id?: string
          p_amount_cents?: number
          p_amount_max_cents?: number
          p_amount_min_cents?: number
          p_apply_from?: string
          p_budget_line_id?: string
          p_description_match?: Database['public']['Enums']['spend_rule_text_match']
          p_description_pattern?: string
          p_retire?: boolean
          p_rule_id?: string
          p_target_kind?: Database['public']['Enums']['spend_target_kind']
          p_text_pattern?: string
          p_up_category_ids?: string[]
        }
        Returns: {
          amount_cents: number
          from_allowance_member_id: string
          from_budget_line_id: string
          from_reason: Database['public']['Enums']['spend_resolution_reason']
          from_target_kind: Database['public']['Enums']['spend_target_kind']
          posted_at: string
          status: Database['public']['Enums']['transaction_status']
          to_allowance_member_id: string
          to_budget_line_id: string
          to_reason: Database['public']['Enums']['spend_resolution_reason']
          to_rule_id: string
          to_target_kind: Database['public']['Enums']['spend_target_kind']
          transaction_id: string
        }[]
      }
      reconcile_annual_cents: {
        Args: {
          p_amount: number
          p_frequency: Database['public']['Enums']['frequency']
          p_interval_count: number
        }
        Returns: number
      }
      reconcile_buyer_account: {
        Args: { p_household_id: string; p_recipient_member_id: string }
        Returns: string
      }
      reconcile_derived_lines: { Args: { p_household_id: string }; Returns: undefined }
      reconcile_generic_total: { Args: { p_breakdown_id: string }; Returns: number }
      reconcile_gift_total: {
        Args: { p_household_id: string; p_member_id: string }
        Returns: number
      }
      reconcile_joint_up_accounts: {
        Args: { p_household_id: string; p_present_external_ids: string[] }
        Returns: undefined
      }
      reconcile_source_accounts: {
        Args: {
          p_household_id: string
          p_owner_member_id: string
          p_present_external_ids: string[]
          p_source: Database['public']['Enums']['ledger_source']
        }
        Returns: undefined
      }
      register_apns_device: { Args: { p_environment: string; p_token: string }; Returns: undefined }
      reorder_spend_rules: { Args: { p_rule_ids: string[] }; Returns: undefined }
      resend_api_key: { Args: Record<PropertyKey, never>; Returns: string }
      retirable_budget_line: {
        Args: { p_budget_line_id: string; p_on: string }
        Returns: {
          allowance_member_id: string | null
          amount_cents: number
          breakdown_id: string | null
          created_at: string
          destination_account_id: string | null
          frequency: Database['public']['Enums']['frequency']
          gift_recipient_member_id: string | null
          goal_id: string | null
          household_id: string
          id: string
          interval_count: number | null
          is_gift_line: boolean
          line_group: Database['public']['Enums']['budget_group']
          management_url: string | null
          name: string
          retired_on: string | null
          starts_on: string
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'budget_line'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      retire_budget_line: {
        Args: {
          p_budget_line_id: string
          p_new_default_budget_line_id?: string
          p_retire_on?: string
        }
        Returns: undefined
      }
      review_transaction: {
        Args: { p_note?: string; p_reviewed?: boolean; p_transaction_id: string }
        Returns: {
          account_id: string
          amount_cents: number
          category_flagged_wrong_at: string | null
          category_flagged_wrong_by_member_id: string | null
          category_id: string | null
          created_at: string
          deep_link_url: string | null
          description: string
          external_category: string | null
          external_category_since: string
          external_id: string | null
          external_parent_category: string | null
          household_id: string
          id: string
          is_categorizable: boolean | null
          kind: Database['public']['Enums']['transaction_kind']
          member_id: string | null
          notes: string | null
          performing_customer_name: string | null
          posted_at: string
          reviewed_at: string | null
          reviewed_by_member_id: string | null
          source: Database['public']['Enums']['ledger_source']
          status: Database['public']['Enums']['transaction_status']
          transaction_type: string | null
          up_message: string | null
          up_note: string | null
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'transactions'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_calendar_feed_token: { Args: Record<PropertyKey, never>; Returns: undefined }
      revoke_invite_code: { Args: Record<PropertyKey, never>; Returns: undefined }
      revoke_share_grant: { Args: Record<PropertyKey, never>; Returns: undefined }
      set_household_default_budget_line: {
        Args: { p_budget_line_id: string; p_from?: string }
        Returns: undefined
      }
      set_household_pay_account: { Args: { p_account_id: string }; Returns: undefined }
      set_member_date_of_birth: {
        Args: { p_date_of_birth: string; p_member_id: string }
        Returns: undefined
      }
      set_transaction_spend_target: {
        Args: {
          p_allowance_member_id?: string
          p_budget_line_id?: string
          p_target_kind: Database['public']['Enums']['spend_target_kind']
          p_transaction_id: string
        }
        Returns: undefined
      }
      set_up_transaction_category: {
        Args: { p_category: string; p_transaction_id: string }
        Returns: boolean
      }
      spend_resolution: {
        Args: { p_end?: string; p_start?: string; p_transaction_ids?: string[] }
        Returns: {
          allowance_member_id: string
          amount_cents: number
          budget_line_id: string
          posted_at: string
          reason: Database['public']['Enums']['spend_resolution_reason']
          rule_id: string
          rule_version: number
          status: Database['public']['Enums']['transaction_status']
          target_kind: Database['public']['Enums']['spend_target_kind']
          transaction_id: string
        }[]
      }
      spend_rule_effective_from: {
        Args: { p_apply_from: string; p_household_id: string }
        Returns: string
      }
      store_up_token: { Args: { p_member_id: string; p_token: string }; Returns: undefined }
      store_up_webhook: {
        Args: { p_member_id: string; p_secret: string; p_webhook_id: string }
        Returns: undefined
      }
      sync_up_categories: { Args: { p_rows: Json }; Returns: undefined }
      sync_up_transactions: {
        Args: { p_household_id: string; p_rows: Json }
        Returns: {
          id: string
          inserted: boolean
        }[]
      }
      up_customer_handles: {
        Args: { p_household_id: string }
        Returns: {
          handle: string
          member_id: string
        }[]
      }
      up_token_for_member: { Args: { p_member_id: string }; Returns: string }
      up_webhook_secret_for_member: { Args: { p_member_id: string }; Returns: string }
      update_spend_rule: {
        Args: {
          p_account_ids?: string[]
          p_amount_cents?: number
          p_amount_max_cents?: number
          p_amount_min_cents?: number
          p_apply_from?: string
          p_description_match?: Database['public']['Enums']['spend_rule_text_match']
          p_description_pattern?: string
          p_rule_id: string
          p_text_pattern?: string
          p_up_category_ids?: string[]
        }
        Returns: number
      }
      upsert_accounts: { Args: { rows: Json }; Returns: undefined }
      upsert_payslip_with_lines: { Args: { p_lines: Json; p_payslip: Json }; Returns: string }
      vapid_keys: {
        Args: Record<PropertyKey, never>
        Returns: {
          private_key: string
          public_key: string
          subject: string
        }[]
      }
      visible_balance_account_ids: { Args: Record<PropertyKey, never>; Returns: string[] }
      visible_spend_rule_ids: { Args: Record<PropertyKey, never>; Returns: string[] }
      write_budget_line_retirement: {
        Args: {
          p_line: Omit<
            Database['public']['Tables']['budget_line']['Row'],
            Database['public']['Tables']['budget_line']['ComputedFields']
          >
          p_on: string
        }
        Returns: undefined
      }
      write_household_default_budget_line: {
        Args: { p_budget_line_id: string; p_from: string; p_household_id: string }
        Returns: undefined
      }
      write_spend_rule_version: {
        Args: {
          p_account_ids: string[]
          p_amount_cents: number
          p_amount_max_cents: number
          p_amount_min_cents: number
          p_description_match: Database['public']['Enums']['spend_rule_text_match']
          p_description_pattern: string
          p_from: string
          p_rule_id: string
          p_sort_order: number
          p_text_pattern: string
          p_up_category_ids: string[]
        }
        Returns: number
      }
    }
    Enums: {
      account_type: 'transaction' | 'savings' | 'credit' | 'offset' | 'other' | 'home_loan'
      breakdown_kind: 'generic'
      budget_group: 'needs' | 'wants' | 'discretionary' | 'savings' | 'investments'
      category_kind: 'income' | 'expense'
      deduction_basis: 'amount' | 'distance' | 'hours'
      deduction_category: 'work_expense' | 'donation' | 'tax_agent_fees'
      equity_instrument_type: 'option' | 'share'
      equity_vesting_frequency: 'monthly' | 'quarterly' | 'annual'
      frequency:
        | 'weekly'
        | 'fortnightly'
        | 'monthly'
        | 'annual'
        | 'quarterly'
        | 'biannual'
        | 'every_n_weeks'
        | 'every_n_months'
      inflow_type: 'salary' | 'wage' | 'other' | 'reimbursement' | 'hobby' | 'gift'
      ledger_source: 'up' | 'manual' | 'redbark'
      notification_trigger:
        | 'buffer_negative'
        | 'goal_eta_slipped'
        | 'temporary_item_expiring'
        | 'fy_boundary'
        | 'gift_purchase_unassigned'
        | 'gift_candidate_new'
        | 'up_disconnected'
        | 'transaction_review'
      one_off_tax_treatment:
        'ordinary' | 'genuine_redundancy' | 'employment_termination' | 'unused_leave'
      payslip_line_kind: 'earning' | 'tax'
      payslip_tax_component: 'payg' | 'stsl'
      spend_allocation_origin: 'member_choice' | 'confirmed_suggestion' | 'suggestion'
      spend_resolution_reason:
        'member_choice' | 'confirmed_suggestion' | 'rule' | 'suggestion' | 'default'
      spend_rule_text_match: 'contains' | 'equals'
      spend_target_kind: 'budget_line' | 'allowance' | 'not_budgeted'
      super_contribution_kind:
        'salary_sacrifice' | 'personal_deductible' | 'personal_non_concessional' | 'spouse'
      super_contribution_mode: 'amount' | 'percent'
      tax_residency: 'resident' | 'foreign_resident'
      trade_side: 'buy' | 'sell'
      transaction_kind: 'income' | 'expense' | 'transfer'
      transaction_status: 'pending' | 'settled'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      account_type: ['transaction', 'savings', 'credit', 'offset', 'other', 'home_loan'],
      breakdown_kind: ['generic'],
      budget_group: ['needs', 'wants', 'discretionary', 'savings', 'investments'],
      category_kind: ['income', 'expense'],
      deduction_basis: ['amount', 'distance', 'hours'],
      deduction_category: ['work_expense', 'donation', 'tax_agent_fees'],
      equity_instrument_type: ['option', 'share'],
      equity_vesting_frequency: ['monthly', 'quarterly', 'annual'],
      frequency: [
        'weekly',
        'fortnightly',
        'monthly',
        'annual',
        'quarterly',
        'biannual',
        'every_n_weeks',
        'every_n_months',
      ],
      inflow_type: ['salary', 'wage', 'other', 'reimbursement', 'hobby', 'gift'],
      ledger_source: ['up', 'manual', 'redbark'],
      notification_trigger: [
        'buffer_negative',
        'goal_eta_slipped',
        'temporary_item_expiring',
        'fy_boundary',
        'gift_purchase_unassigned',
        'gift_candidate_new',
        'up_disconnected',
        'transaction_review',
      ],
      one_off_tax_treatment: [
        'ordinary',
        'genuine_redundancy',
        'employment_termination',
        'unused_leave',
      ],
      payslip_line_kind: ['earning', 'tax'],
      payslip_tax_component: ['payg', 'stsl'],
      spend_allocation_origin: ['member_choice', 'confirmed_suggestion', 'suggestion'],
      spend_resolution_reason: [
        'member_choice',
        'confirmed_suggestion',
        'rule',
        'suggestion',
        'default',
      ],
      spend_rule_text_match: ['contains', 'equals'],
      spend_target_kind: ['budget_line', 'allowance', 'not_budgeted'],
      super_contribution_kind: [
        'salary_sacrifice',
        'personal_deductible',
        'personal_non_concessional',
        'spouse',
      ],
      super_contribution_mode: ['amount', 'percent'],
      tax_residency: ['resident', 'foreign_resident'],
      trade_side: ['buy', 'sell'],
      transaction_kind: ['income', 'expense', 'transfer'],
      transaction_status: ['pending', 'settled'],
    },
  },
} as const
