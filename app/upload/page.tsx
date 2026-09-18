'use client';

import { useState } from 'react';
import { Music, Flower, UtensilsCrossed, Castle, Camera, UploadCloud } from 'lucide-react';

export default function ContractUploadDashboard() {
  const [uploading, setUploading] = useState<string | null>(null);

  // Clean dashboard icon grid mappings
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
      // 1. Pack the real document file binary data inside a standardized web form package
      const formData = new FormData();
      formData.append('file', file);
      formData.append('vendorType', categoryId);

      // 2. Fire the form package over to your fresh Next.js backend text extraction script
      const response = await fetch('/api/parse-contract', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Server parsing runtime pipeline failed');
      }

      alert(`Success! Real text successfully scraped from "${file.name}" and locked into your Bronze table!`);
    } catch (err: any) {
      console.error(err);
      alert(`Upload failed: ${err.message || 'Unknown network processing glitch'}`);
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
                    <span className="flex items-center gap-2 animate-pulse">Parsing file...</span>
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
