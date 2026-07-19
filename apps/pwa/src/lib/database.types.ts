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
      accounts: {
        Row: {
          balance_cents: number
          created_at: string
          currency: string
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
          balance_cents?: number
          created_at?: string
          currency?: string
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
          balance_cents?: number
          created_at?: string
          currency?: string
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
      budget_line: {
        Row: {
          amount_cents: number
          created_at: string
          derived_source: Database['public']['Enums']['budget_derived_source'] | null
          frequency: Database['public']['Enums']['frequency']
          goal_id: string | null
          household_id: string
          id: string
          line_group: Database['public']['Enums']['budget_group']
          name: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          derived_source?: Database['public']['Enums']['budget_derived_source'] | null
          frequency: Database['public']['Enums']['frequency']
          goal_id?: string | null
          household_id: string
          id?: string
          line_group: Database['public']['Enums']['budget_group']
          name: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          derived_source?: Database['public']['Enums']['budget_derived_source'] | null
          frequency?: Database['public']['Enums']['frequency']
          goal_id?: string | null
          household_id?: string
          id?: string
          line_group?: Database['public']['Enums']['budget_group']
          name?: string
          updated_at?: string
        }
        Relationships: [
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
          gift_budget_id: string
          household_id: string
          id: string
          purchased_on: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          description?: string
          gift_budget_id: string
          household_id: string
          id?: string
          purchased_on: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          description?: string
          gift_budget_id?: string
          household_id?: string
          id?: string
          purchased_on?: string
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
            foreignKeyName: 'gift_purchase_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      gift_recipient: {
        Row: {
          created_at: string
          household_id: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
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
        ]
      }
      households: {
        Row: {
          created_at: string
          id: string
          invite_code: string | null
          invite_code_expires_at: string | null
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          invite_code?: string | null
          invite_code_expires_at?: string | null
          name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          invite_code?: string | null
          invite_code_expires_at?: string | null
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      inflows: {
        Row: {
          amount_cents: number | null
          created_at: string
          hourly_rate_cents: number | null
          hours_per_period: number | null
          household_id: string
          id: string
          interval_weeks: number | null
          member_id: string | null
          name: string
          schedule: Database['public']['Enums']['frequency']
          taxable: boolean
          type: Database['public']['Enums']['inflow_type']
          updated_at: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          hourly_rate_cents?: number | null
          hours_per_period?: number | null
          household_id: string
          id?: string
          interval_weeks?: number | null
          member_id?: string | null
          name: string
          schedule: Database['public']['Enums']['frequency']
          taxable?: boolean
          type: Database['public']['Enums']['inflow_type']
          updated_at?: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          hourly_rate_cents?: number | null
          hours_per_period?: number | null
          household_id?: string
          id?: string
          interval_weeks?: number | null
          member_id?: string | null
          name?: string
          schedule?: Database['public']['Enums']['frequency']
          taxable?: boolean
          type?: Database['public']['Enums']['inflow_type']
          updated_at?: string
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
      savings_goal: {
        Row: {
          created_at: string
          current_balance_cents: number
          household_id: string
          id: string
          linked_account_id: string | null
          name: string
          target_amount_cents: number
          target_date: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_balance_cents?: number
          household_id: string
          id?: string
          linked_account_id?: string | null
          name: string
          target_amount_cents: number
          target_date?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_balance_cents?: number
          household_id?: string
          id?: string
          linked_account_id?: string | null
          name?: string
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
            referencedRelation: 'accounts'
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
          interval_weeks: number | null
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
          interval_weeks?: number | null
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
          interval_weeks?: number | null
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
            referencedRelation: 'accounts'
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
          help_debt_cents: number
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
          help_debt_cents?: number
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
          help_debt_cents?: number
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
            referencedRelation: 'accounts'
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      clear_up_token: { Args: { p_member_id: string }; Returns: undefined }
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
      household_ids_for_current_user: { Args: never; Returns: string[] }
      join_household: {
        Args: { p_code: string; p_member_name: string }
        Returns: string
      }
      revoke_invite_code: { Args: never; Returns: undefined }
      store_up_token: {
        Args: { p_member_id: string; p_token: string }
        Returns: undefined
      }
      up_token_for_member: { Args: { p_member_id: string }; Returns: string }
    }
    Enums: {
      account_type: 'transaction' | 'savings' | 'credit' | 'offset' | 'other'
      budget_derived_source: 'gift'
      budget_group: 'needs' | 'wants' | 'discretionary' | 'savings' | 'investments'
      category_kind: 'income' | 'expense'
      frequency:
        'weekly' | 'fortnightly' | 'monthly' | 'annual' | 'quarterly' | 'biannual' | 'every_n_weeks'
      inflow_type: 'salary' | 'wage' | 'other' | 'reimbursement' | 'hobby' | 'gift'
      ledger_source: 'up' | 'manual'
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
      account_type: ['transaction', 'savings', 'credit', 'offset', 'other'],
      budget_derived_source: ['gift'],
      budget_group: ['needs', 'wants', 'discretionary', 'savings', 'investments'],
      category_kind: ['income', 'expense'],
      frequency: [
        'weekly',
        'fortnightly',
        'monthly',
        'annual',
        'quarterly',
        'biannual',
        'every_n_weeks',
      ],
      inflow_type: ['salary', 'wage', 'other', 'reimbursement', 'hobby', 'gift'],
      ledger_source: ['up', 'manual'],
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
