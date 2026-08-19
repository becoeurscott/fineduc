'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Amount,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Skeleton,
  Table,
  TableScroll,
  Td,
  Th,
  Tr,
} from '@fineduc/ui'
import { getApi, qk } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { PageHeader } from '@/components/shell'

export default function StudentsPage() {
  const { t, intlLocale } = useApp()
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [classGroupId, setClassGroupId] = useState('')

  const { data: classGroups } = useQuery({ queryKey: qk.classGroups, queryFn: () => getApi().getClassGroups() })

  const query = { search: search || undefined, classGroupId: classGroupId || undefined }
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: qk.students(query),
    queryFn: () => getApi().listStudents(query),
  })

  return (
    <>
      <PageHeader title={t('students.title')} description={data ? `${data.length}` : undefined} />

      {/* Filters in one row above the content. */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('students.searchPlaceholder')}
          aria-label={t('common.search')}
          className="sm:max-w-sm"
        />
        <Select
          value={classGroupId}
          onChange={(e) => setClassGroupId(e.target.value)}
          aria-label={t('common.class')}
          className="sm:max-w-[12rem]"
        >
          <option value="">{t('common.all')}</option>
          {classGroups?.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        {isError ? (
          <ErrorState title={t('common.error')} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : !data?.length ? (
          <EmptyState title={t('common.noResults')} />
        ) : (
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>{t('common.student')}</Th>
                  <Th>{t('students.matricule')}</Th>
                  <Th>{t('common.class')}</Th>
                  <Th align="right">{t('common.balance')}</Th>
                  <Th align="right">{t('students.nextDue')}</Th>
                </tr>
              </thead>
              <tbody>
                {data.map((student) => {
                  const owes = Number(student.balance.amountMinor) > 0
                  return (
                    <Tr key={student.id} onClick={() => router.push(`/students/${student.id}`)}>
                      <Td>
                        <span className="font-medium">
                          {student.firstName} {student.lastName}
                        </span>
                      </Td>
                      <Td className="text-slate">{student.matricule}</Td>
                      <Td className="text-slate">{student.className}</Td>
                      <Td align="right">
                        <Amount
                          value={student.balance}
                          locale={intlLocale}
                          size="sm"
                          className={owes ? 'font-semibold text-danger' : 'text-positive'}
                        />
                      </Td>
                      <Td align="right">
                        {owes ? (
                          student.daysOverdue > 0 ? (
                            <Badge tone="danger">
                              {student.daysOverdue} {t('arrears.days')} {t('arrears.daysLate').toLowerCase()}
                            </Badge>
                          ) : (
                            <span className="text-xs text-slate">{student.nextDueOn}</span>
                          )
                        ) : (
                          <Badge tone="positive">à jour</Badge>
                        )}
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </Card>
    </>
  )
}
