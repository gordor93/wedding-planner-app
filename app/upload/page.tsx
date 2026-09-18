'use client';

import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Music, Flower, UtensilsCrossed, Castle, Camera, UploadCloud } from 'lucide-react';

// Initialize Supabase client directly inside the file using environment configurations
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function ContractUploadDashboard() {
  const [uploading, setUploading] = useState<string | null>(null);

  // Modern configuration mapping components natively
  const contractCategories = [
    { id: 'dj', name: 'DJ & Entertainment', icon: Music, color: 'text-indigo-600 bg-indigo-50 border-indigo-100' },
    { id: 'florist', name: 'Florist & Decor', icon: Flower, color: 'text-rose-600 bg-rose-50 border-rose-100' },
    { id: 'catering', name: 'Catering & Food', icon: UtensilsCrossed, color: 'text-amber-600 bg-amber-50 border-amber-100' },
    { id: 'venue', name: 'Venue Contract', icon: Castle, color: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
    { id: 'photo', name: 'Photography & Video', icon: Camera, color: 'text-violet-600 bg-violet-50 border-violet-100' },
  ];

  const handleContractUpload = async (event: React.ChangeEvent<HTMLInputElement>, categoryId: string) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(categoryId);

    try {
      // Temporary placeholder text payload until backend parsing engine is hooked up
      const mockExtractedText = `Raw uploaded text template for a ${categoryId} contract.`;

      const { data, error } = await supabase
        .from('bronze_contract_raw_payloads')
        .insert([
          {
            file_name: file.name,
            raw_text: mockExtractedText,
            vendor_type: categoryId,
            status: 'pending'
          }
        ]);

      if (error) throw error;
      alert(`${file.name} successfully uploaded to the ${categoryId} category!`);
    } catch (err:any) {
      console.error(err);
      alert(`Upload failed: ${err.message || 'Unknown network error'}.`);
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        {/* Header Block */}
        <div className="mb-10 pb-6 border-b border-slate-200">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Vendor Contracts
          </h1>
          <p className="mt-2 text-base text-slate-500">
            Select a dedicated category below to upload your contract files (.pdf or .docx).
          </p>
        </div>

        {/* Dashboard Grid Layout */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {contractCategories.map((category) => {
            const IconComponent = category.icon;
            return (
              <div
                key={category.id}
                className="group relative bg-white border border-slate-200/80 rounded-2xl p-6 flex flex-col justify-between shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200"
              >
                <div>
                  {/* Modern Icon Badge */}
                  <div className={`inline-flex items-center justify-center p-3 rounded-xl border ${category.color} mb-4 group-hover:scale-105 transition-transform duration-200`}>
                    <IconComponent className="h-6 w-6" aria-hidden="true" />
                  </div>

                  <h3 className="text-lg font-semibold text-slate-800 tracking-tight mb-1">
                    {category.name}
                  </h3>
                  <p className="text-xs text-slate-400 mb-6">
                    Accepts PDF or Word documents
                  </p>
                </div>

                {/* Styled Custom Upload Button */}
                <label className={`w-full flex items-center justify-center gap-2 border font-medium py-2.5 px-4 rounded-xl cursor-pointer text-sm transition-all duration-200 ${
                  uploading === category.id
                    ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800 hover:border-slate-800 shadow-sm shadow-slate-900/10'
                }`}>
                  {uploading === category.id ? (
                    <span className="flex items-center gap-2 animate-pulse">Processing...</span>
                  ) : (
                    <>
                      <UploadCloud className="h-4 w-4 opacity-80" />
                      <span>Upload Contract</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept=".pdf, .docx, application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={(e) => handleContractUpload(e, category.id)}
                    disabled={uploading !== null}
                  />
                </label>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}