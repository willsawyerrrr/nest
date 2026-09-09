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
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
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
          name: string
          owner_member_id: string | null
          source: Database['public']['Enums']['ledger_source']
          type: Database['public']['Enums']['account_type']
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          deleted_from_source_at?: string | null
          exclude_from_net_worth?: boolean
          external_id?: string | null
          household_id: string
          id?: string
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
          name: string
          updated_at: string
        }
        Insert: {
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
          name: string
          updated_at?: string
        }
        Update: {
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
          name?: string
          updated_at?: string
        }
        Relationships: [
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
          updated_at: string
          work_use_percent: number
        }
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
          updated_at?: string
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
          updated_at?: string
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
        ]
      }
      deduction_group: {
        Row: {
          created_at: string
          financial_year: number
          household_id: string
          id: string
          member_id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          financial_year: number
          household_id: string
          id?: string
          member_id: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          financial_year?: number
          household_id?: string
          id?: string
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
          file_name: string
          household_id: string
          id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          deduction_id: string
          file_name: string
          household_id: string
          id?: string
          storage_path: string
        }
        Update: {
          created_at?: string
          deduction_id?: string
          file_name?: string
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
      members: {
        Row: {
          created_at: string
          date_of_birth: string | null
          email: string | null
          household_id: string
          id: string
          name: string
          up_connected_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          household_id: string
          id?: string
          name: string
          up_connected_at?: string | null
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
      transactions: {
        Row: {
          account_id: string
          amount_cents: number
          category_id: string | null
          created_at: string
          description: string
          external_category: string | null
          external_id: string | null
          household_id: string
          id: string
          kind: Database['public']['Enums']['transaction_kind']
          member_id: string | null
          notes: string | null
          posted_at: string
          source: Database['public']['Enums']['ledger_source']
          status: Database['public']['Enums']['transaction_status']
          updated_at: string
        }
        Insert: {
          account_id: string
          amount_cents: number
          category_id?: string | null
          created_at?: string
          description?: string
          external_category?: string | null
          external_id?: string | null
          household_id: string
          id?: string
          kind: Database['public']['Enums']['transaction_kind']
          member_id?: string | null
          notes?: string | null
          posted_at: string
          source?: Database['public']['Enums']['ledger_source']
          status?: Database['public']['Enums']['transaction_status']
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount_cents?: number
          category_id?: string | null
          created_at?: string
          description?: string
          external_category?: string | null
          external_id?: string | null
          household_id?: string
          id?: string
          kind?: Database['public']['Enums']['transaction_kind']
          member_id?: string | null
          notes?: string | null
          posted_at?: string
          source?: Database['public']['Enums']['ledger_source']
          status?: Database['public']['Enums']['transaction_status']
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
    }
    Functions: {
      anthropic_api_key: { Args: never; Returns: string }
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
      clear_up_token: { Args: { p_member_id: string }; Returns: undefined }
      create_calendar_feed_token: { Args: never; Returns: string }
      create_deduction_with_receipts: {
        Args: { p_deduction: Json; p_receipts: Json }
        Returns: string
      }
      create_household: {
        Args: { p_member_name: string; p_name: string }
        Returns: string
      }
      create_invite_code: {
        Args: never
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
      current_member_ids: { Args: never; Returns: string[] }
      hidden_gift_budget_ids_for_current_member: {
        Args: never
        Returns: string[]
      }
      hidden_gift_recipient_ids_for_current_member: {
        Args: never
        Returns: string[]
      }
      hidden_gift_transaction_ids_for_current_member: {
        Args: never
        Returns: string[]
      }
      household_ids_for_current_user: { Args: never; Returns: string[] }
      household_super_account_ids: { Args: never; Returns: string[] }
      join_household: {
        Args: { p_code: string; p_member_name: string }
        Returns: string
      }
      payslip_financial_year: {
        Args: { paid_on: string; period_end: string }
        Returns: number
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
      reconcile_derived_lines: {
        Args: { p_household_id: string }
        Returns: undefined
      }
      reconcile_generic_total: {
        Args: { p_breakdown_id: string }
        Returns: number
      }
      reconcile_gift_total: {
        Args: { p_household_id: string; p_member_id: string }
        Returns: number
      }
      reconcile_joint_up_accounts: {
        Args: { p_household_id: string; p_present_external_ids: string[] }
        Returns: undefined
      }
      reconcile_up_accounts: {
        Args: {
          p_household_id: string
          p_owner_member_id: string
          p_present_external_ids: string[]
        }
        Returns: undefined
      }
      resend_api_key: { Args: never; Returns: string }
      revoke_calendar_feed_token: { Args: never; Returns: undefined }
      revoke_invite_code: { Args: never; Returns: undefined }
      revoke_share_grant: { Args: never; Returns: undefined }
      set_household_pay_account: {
        Args: { p_account_id: string }
        Returns: undefined
      }
      store_up_token: {
        Args: { p_member_id: string; p_token: string }
        Returns: undefined
      }
      sync_up_gift_transactions: {
        Args: {
          p_account_ids: string[]
          p_household_id: string
          p_since: string
          rows: Json
        }
        Returns: undefined
      }
      up_token_for_member: { Args: { p_member_id: string }; Returns: string }
      upsert_payslip_with_lines: {
        Args: { p_lines: Json; p_payslip: Json }
        Returns: string
      }
      upsert_up_accounts: { Args: { rows: Json }; Returns: undefined }
      vapid_keys: {
        Args: never
        Returns: {
          private_key: string
          public_key: string
          subject: string
        }[]
      }
      visible_balance_account_ids: { Args: never; Returns: string[] }
    }
    Enums: {
      account_type: 'transaction' | 'savings' | 'credit' | 'offset' | 'other' | 'home_loan'
      breakdown_kind: 'generic'
      budget_group: 'needs' | 'wants' | 'discretionary' | 'savings' | 'investments'
      category_kind: 'income' | 'expense'
      deduction_basis: 'amount' | 'distance'
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
      ledger_source: 'up' | 'manual'
      notification_trigger:
        'buffer_negative' | 'goal_eta_slipped' | 'temporary_item_expiring' | 'fy_boundary'
      one_off_tax_treatment:
        'ordinary' | 'genuine_redundancy' | 'employment_termination' | 'unused_leave'
      payslip_line_kind: 'earning' | 'tax'
      payslip_tax_component: 'payg' | 'stsl'
      super_contribution_kind:
        'salary_sacrifice' | 'personal_deductible' | 'personal_non_concessional' | 'spouse'
      super_contribution_mode: 'amount' | 'percent'
      tax_residency: 'resident' | 'foreign_resident'
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
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
      deduction_basis: ['amount', 'distance'],
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
      ledger_source: ['up', 'manual'],
      notification_trigger: [
        'buffer_negative',
        'goal_eta_slipped',
        'temporary_item_expiring',
        'fy_boundary',
      ],
      one_off_tax_treatment: [
        'ordinary',
        'genuine_redundancy',
        'employment_termination',
        'unused_leave',
      ],
      payslip_line_kind: ['earning', 'tax'],
      payslip_tax_component: ['payg', 'stsl'],
      super_contribution_kind: [
        'salary_sacrifice',
        'personal_deductible',
        'personal_non_concessional',
        'spouse',
      ],
      super_contribution_mode: ['amount', 'percent'],
      tax_residency: ['resident', 'foreign_resident'],
      transaction_kind: ['income', 'expense', 'transfer'],
      transaction_status: ['pending', 'settled'],
    },
  },
} as const
